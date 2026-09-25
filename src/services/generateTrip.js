import { useSyncExternalStore } from "react";
import { supabase } from "../lib/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PROXY_URL =
  import.meta.env.VITE_GENERATE_TRIP_URL ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/generate-trip` : "/api/generate-trip");

// Module-level singleton state — survives route navigation (Setup → Swipe).
let state = {
  streaming: false,
  locations: [],
  enriched: [],
  done: false,
  count: 0,
  error: null,
};

const listeners = new Set();
let abortCtrl = null;

function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return state;
}

export function usePipeline() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function resetPipeline() {
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = null;
  state = { streaming: false, locations: [], enriched: [], done: false, count: 0, error: null };
  listeners.forEach((fn) => fn());
}

export async function startPipeline({ destination, startDate, endDate, preferences }) {
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();

  state = { streaming: true, locations: [], enriched: [], done: false, count: 0, error: null };
  listeners.forEach((fn) => fn());

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    emit({ streaming: false, error: "Not signed in" });
    return;
  }

  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ destination, startDate, endDate, preferences }),
      signal: abortCtrl.signal,
    });

    if (!res.ok || !res.body) {
      const errBody = await res.json().catch(() => ({}));
      emit({ streaming: false, error: errBody.error || `Pipeline failed (${res.status})` });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let payload;
        try {
          payload = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        if (payload.type === "locations") {
          emit({ locations: payload.locations || [] });
        } else if (payload.type === "enriched") {
          emit({ enriched: [...state.enriched, payload.location] });
        } else if (payload.type === "done") {
          emit({ streaming: false, done: true, count: payload.count ?? state.enriched.length });
        } else if (payload.type === "error") {
          emit({ streaming: false, error: payload.message || "Pipeline error" });
        }
      }
    }

    // Stream closed without a done event
    if (state.streaming) {
      emit({ streaming: false, done: true, count: state.enriched.length });
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    emit({ streaming: false, error: String(err) });
  }
}
