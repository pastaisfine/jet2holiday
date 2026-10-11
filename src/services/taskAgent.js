import { supabase } from "../lib/supabase";

/**
 * Client side of the task agent: one streamed request that returns a draft
 * list of tasks for the human to review.
 *
 * Two things this file gets right that are easy to get wrong:
 *
 *  - SSE is reassembled across reads. A network chunk lands wherever it lands,
 *    so a single `data:` line routinely arrives split across two `read()`
 *    calls. Splitting each chunk independently and dropping anything that
 *    doesn't parse means a `result` frame can vanish while the parse itself
 *    succeeded — which the user sees as "No tasks found".
 *
 *  - The request is made as the signed-in member, not as the anon key. The
 *    edge function verifies the JWT and the trip membership before spending
 *    anything on Gemini, so calling it with the anon key is now rejected.
 */

/** The agent URL, falling back to the project's own functions host. */
function taskAgentUrl() {
  return (
    import.meta.env.VITE_TASK_AGENT_URL ||
    (import.meta.env.VITE_SUPABASE_URL
      ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/task-agent`
      : null)
  );
}

/**
 * Pulls complete SSE frames out of an arbitrarily chunked byte stream.
 *
 * Returns the events parsed so far and the unconsumed tail, so the caller can
 * carry the remainder into the next read.
 *
 * Line endings are normalised first: a CRLF stream is `...\r\n\r\n...`, which
 * does not contain the substring `\n\n`, so searching for that boundary on
 * raw CRLF finds nothing and silently discards the entire response. Only the
 * two-character `\r\n` is replaced, so a lone `\r` dangling at a chunk
 * boundary survives until its `\n` arrives and is normalised on the next pass.
 */
export function drainSseEvents(input) {
  const buffer = input.replace(/\r\n/g, "\n");
  const events = [];
  const boundary = buffer.lastIndexOf("\n\n");
  if (boundary === -1) return { events, rest: buffer };

  const complete = buffer.slice(0, boundary);
  const rest = buffer.slice(boundary + 2);

  for (const frame of complete.split("\n\n")) {
    const line = frame.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      // A frame that is complete but not JSON is a server bug, not a reason to
      // abandon the stream: the result may still arrive after it.
    }
  }

  return { events, rest };
}

export async function parseTasksFromMessage(message, tripContext = {}, onUpdate = null) {
  const url = taskAgentUrl();
  if (!url) throw new Error("No task agent URL configured (VITE_TASK_AGENT_URL)");

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (sessionError || !token) {
    throw new Error("Sign in to ask the task agent.");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message, tripContext }),
  });

  if (!res.ok) {
    let errMessage = `Task agent returned ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) errMessage = body.error;
    } catch {}
    throw new Error(errMessage);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let finalTasks = [];
  let errorMsg = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = drainSseEvents(buffer);
    buffer = rest;

    for (const event of events) {
      if (event.type === "log") {
        if (onUpdate) onUpdate(event.message);
      } else if (event.type === "result") {
        finalTasks = Array.isArray(event.tasks) ? event.tasks : [];
      } else if (event.type === "error") {
        errorMsg = event.error;
      }
    }
  }

  if (errorMsg) throw new Error(errorMsg);

  return finalTasks;
}