import { useSyncExternalStore } from "react";
import { supabase } from "../lib/supabase";
import { normaliseDays } from "../lib/cardTargets";
import { CLIENT_FAILURE, DECK_FAILURE } from "../lib/deckFailure";
import { dayCount } from "../utils/date";
import {
  buildDeckId,
  getDeck,
  getDeckCards,
  subscribeDeckCards,
  subscribeDeckStatus,
} from "./tripService";

const PROXY_URL =
  import.meta.env.VITE_GENERATE_TRIP_URL ||
  (import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-trip`
    : "/api/generate-trip");

// Module-level singleton state — survives route navigation (Setup → Swipe).
let state = {
  deckId: null,
  // 'idle' | 'generating' | 'done' | 'error'. Derived from deck.status, so a
  // page reload mid-generation resumes rather than restarting.
  phase: "idle",
  // Set once Gemini has answered and we know the size of the incoming deck.
  expectedCount: 0,
  cards: [],
  error: null,
  // Machine-readable reason, when the server or the client knows one. Paired
  // with `error` (the raw diagnostic, for the logs) so the UI can be handed a
  // cause it is allowed to state instead of inferring one.
  errorCode: null,
};

const listeners = new Set();
let unsubscribers = [];

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

function teardown() {
  unsubscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // A channel may already be gone; unsubscribing twice is harmless.
    }
  });
  unsubscribers = [];
}

function resetState() {
  state = {
    deckId: null,
    phase: "idle",
    expectedCount: 0,
    cards: [],
    error: null,
    errorCode: null,
  };
  listeners.forEach((fn) => fn());
}

export function resetPipeline() {
  teardown();
  resetState();
}

/**
 * Ensures a deck exists for this (destination, preferences) pair and streams it
 * in.
 *
 * The work itself is in the database, not this connection: the edge function
 * inserts card rows as SerpApi results resolve, and Realtime delivers them. So
 * navigating away mid-generation, or reloading, resumes from whatever has
 * landed instead of paying for the whole pipeline again.
 *
 * Returns once the deck is claimed and the subscriptions are live, not once
 * generation is finished. Resolves with the id of the deck the streamed cards
 * belong to (null when there is no session to generate for), so callers can
 * record which deck their local cards came from.
 */
export async function startPipeline({
  destination,
  startDate,
  endDate,
  preferences,
  tripId,
  force = false,
}) {
  teardown();
  const finalDest = (destination || "").trim() || "Lisbon, Portugal";
  // Sizes the deck and is part of the cache key, so it has to agree exactly
  // with the edge function's own arithmetic — which is inclusive of both ends,
  // the same convention dayCount and the itinerary already use.
  const tripDays = normaliseDays(startDate && endDate ? dayCount(startDate, endDate) : null);
  const deckId = buildDeckId(finalDest, preferences, tripDays);

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    resetState();
    emit({ phase: "error", error: "Not signed in", errorCode: CLIENT_FAILURE.NOT_SIGNED_IN });
    return null;
  }

  emit({ deckId, phase: "generating", expectedCount: 0, cards: [], error: null, errorCode: null });

  const watch = (id) => {
    unsubscribers.push(
      subscribeDeckCards(id, (card) => {
        // Realtime can redeliver on reconnect, so dedupe by id rather than
        // trusting each event to be new.
        if (state.cards.some((c) => c.id === card.id)) return;
        emit({ cards: [...state.cards, card] });
      })
    );

    unsubscribers.push(
      subscribeDeckStatus(id, (deck) => {
        // The column is location_count. Reading a name that does not exist
        // left expectedCount undefined forever, so the progress line could
        // never say "4 of 12 spots ready".
        if (deck.location_count) {
          emit({ expectedCount: deck.location_count });
        }
        if (deck.status === "ready") {
          // error: null because an earlier optimistic failure (e.g. "someone
          // else is generating") must not outlive the deck it was reported for.
          emit({ phase: "done", expectedCount: state.expectedCount || deck.card_count || 0, error: null, errorCode: null });
        } else if (deck.status === "failed") {
          emit({
            phase: state.cards.length > 0 ? "done" : "error",
            error: deck.error_message,
            errorCode: deck.error_code || DECK_FAILURE.UNKNOWN,
          });
        }
      })
    );
  };

  // Subscribe first, so rows that land during the request below are not missed.
  watch(deckId);

  // A deck that already exists may have cards worth showing immediately —
  // including a ready deck, where no generation is needed at all. Reading is
  // always allowed, so this is safe on every path.
  //
  // A failed read is reported rather than treated as absence. Conflating them
  // is how "we couldn't reach the database" ends up on screen as "this
  // destination doesn't have much to offer".
  const read = await getDeck(deckId);
  if (!read.ok) {
    emit({ phase: state.cards.length > 0 ? "done" : "error", error: `Deck read failed: ${deckId}`, errorCode: CLIENT_FAILURE.READ_FAILED });
    return deckId;
  }

  const existing = read.deck;
  if (existing) {
    const cards = await getDeckCards(deckId);
    if (existing.location_count) emit({ expectedCount: existing.location_count });
    if (cards.length > 0) emit({ cards });

    // Nothing to do if the deck is complete, unless the caller is regenerating.
    if (existing.status === "ready" && !force) {
      emit({ phase: "done", expectedCount: existing.location_count || cards.length, error: null, errorCode: null });
      return deckId;
    }
  }

  // The edge function owns the claim: it has the service role, and it is the
  // only writer for decks and trip links. It answers immediately for a cache
  // hit or for a deck another user is already generating, so this call is cheap
  // even when no work happens.
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ destination: finalDest, startDate, endDate, preferences, deckId, tripId, force }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      emit({
        phase: state.cards.length > 0 ? "done" : "error",
        error: payload.error || `Pipeline failed (${res.status})`,
        errorCode: payload.error_code || DECK_FAILURE.UNKNOWN,
      });
      return deckId;
    }

    // Cards arrive over Realtime long before this response. The status here
    // only settles the case where nothing else can: a cache hit, or a failure
    // with no rows to show.
    if (payload.status === "ready") {
      emit({ phase: "done", expectedCount: state.expectedCount || payload.count || 0, error: null, errorCode: null });
    } else if (payload.status === "failed" && !payload.generated) {
      emit({ phase: state.cards.length > 0 ? "done" : "error", error: payload.error, errorCode: payload.error_code || DECK_FAILURE.UNKNOWN });
    } else if (payload.status === "pending" && state.cards.length === 0) {
      // Another user holds the claim, so this request generated nothing and no
      // status event is coming for us. Leaving the phase alone parks the user
      // on "Curating…" forever, so say what is actually happening instead.
      emit({ phase: "error", error: "Someone else is generating this deck right now. Try again shortly.", errorCode: CLIENT_FAILURE.OTHER_USER_GENERATING });
    }
  } catch (err) {
    // A dropped connection does not cancel generation: the edge function keeps
    // inserting rows and Realtime keeps delivering them.
    console.warn("generate-trip request failed, relying on Realtime:", err);
    if (state.cards.length === 0) {
      emit({ phase: "error", error: "Could not reach the trip generator", errorCode: CLIENT_FAILURE.UNREACHABLE });
    }
  }

  return deckId;
}

/**
 * Regenerates the deck for the same (destination, preferences) pair.
 *
 * The client cannot clear the claim itself — decks are read-only to the client —
 * so this is just startPipeline with `force`, which tells the edge function to
 * ignore the ready-deck short-circuit and re-claim the same cache key.
 *
 * Regeneration happens in place: other trips pointing at this deck will see it
 * change under them. Writing a fresh deck row instead is deliberate future work
 * (see the trip_deck_links comment in the migration).
 */
export async function regeneratePipeline(options) {
  return startPipeline({ ...options, force: true });
}
