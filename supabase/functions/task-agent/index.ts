import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Turns a member's free-text "what's still to do" into a draft task list.
 *
 * The draft is a suggestion, never a write: the client shows it for review and
 * commits it as trip_tasks rows itself, under the member's own session. That
 * is why this function needs no service-role key — it never touches the
 * database, and the only thing it spends is a Gemini call.
 *
 * Access is therefore the whole security story here. It used to accept the
 * publishable anon key with no identity check and CORS `*`, which meant anyone
 * who saw the URL could drive Gemini at this project's expense. It now
 * requires a real session and refuses callers who are not in the trip the
 * message is about.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Same ordering as generate-trip and preference, from a live probe of this
// project's key (2026-09-29):
//   gemini-3.5-flash         200, ~2.5s  — works
//   gemini-flash-lite-latest 200, ~0.9s  — works, fastest
//   gemini-3.6-flash         503 overloaded
//   gemini-flash-latest      hangs past 25s
//   gemini-3.1-pro-preview   429, separate tier with no quota on this plan
//
// This used to hardcode gemini-3.6-flash, the one currently overloaded, so
// task parsing failed on every call.
const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
];

const MAX_TASKS = 5;

type Member = { username: string };

type DraftTask = { title: string; description: string; assignee: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/**
 * Reassembles SSE frames from an arbitrarily chunked byte stream.
 *
 * Two things this has to get right, both learned the hard way:
 *
 *  - `chunk.split("\n")` per read drops any frame that straddles a chunk
 *    boundary, which silently loses the `result` frame and reaches the client
 *    as an empty list after a successful parse. The tail is carried into the
 *    next read instead.
 *
 *  - Google's SSE arrives with CRLF line endings. A CRLF stream is
 *    `...\r\n\r\n...`, which does NOT contain the substring `\n\n`, so a
 *    boundary search on `\n\n` finds nothing at all and the whole response is
 *    discarded without a word of error. Line endings are therefore normalised
 *    before framing.
 *
 * Only the two-character `\r\n` is replaced, so a lone `\r` left dangling at a
 * chunk boundary survives until its `\n` arrives and is normalised then.
 */
function drainSseEvents(input: string) {
  const buffer = input.replace(/\r\n/g, "\n");
  const events: unknown[] = [];
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
      // A complete-but-unparseable frame is not a reason to abandon the rest
      // of the stream; the result may still arrive after it.
    }
  }
  return { events, rest };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    return json({ error: "GEMINI_API_KEY is not configured on this server" }, 500);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json({ error: "Supabase credentials not configured" }, 500);
  }

  // Identity comes from the verified session, never from the body.
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt || jwt === Deno.env.get("SUPABASE_ANON_KEY")) {
    return json({ error: "Unauthorized" }, 401);
  }

  let userId: string;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) return json({ error: "Unauthorized" }, 401);
    const userData = await userRes.json();
    userId = userData?.id;
    if (!userId) return json({ error: "Unauthorized" }, 401);
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const message: string = body?.message ?? "";
  const tripContext: Record<string, unknown> = body?.tripContext ?? {};
  const tripId: string = (tripContext?.tripId || "").trim();
  const destination: string = tripContext?.destination || "their destination";
  const self: string = (tripContext?.self || "").trim();
  const claimedMembers: Member[] = Array.isArray(tripContext?.members) ? tripContext.members : [];

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return json({ error: "message is required and must be a non-empty string" }, 400);
  }

  // Membership is checked before anything else: a non-member must not be able
  // to spend this project's Gemini quota, nor have a trip's roster disclosed
  // back to them in the prompt.
  let members: Member[] = [];
  if (tripId) {
    let rows: { user_id: string; profiles: { username: string } | null }[] | null = null;
    try {
      const membersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/trip_members?trip_id=eq.${encodeURIComponent(tripId)}` +
          `&select=user_id,profiles:user_id(username)`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` } },
      );
      if (membersRes.ok) rows = await membersRes.json();
    } catch {
      // Treated as "could not confirm", which denies below rather than allows.
    }

    // Authoritative check is on the caller's user id, not on a name from the
    // body: a self-asserted username is not evidence of membership.
    const isMember = (rows || []).some((r) => r.user_id === userId);
    if (!isMember) {
      return json({ error: "You are not a member of this trip." }, 403);
    }
    members = (rows || [])
      .map((r) => ({ username: r.profiles?.username || "" }))
      .filter((m) => m.username);
  }

  const roster = members.length > 0
    ? members
    : claimedMembers.filter(
      (m) => typeof m?.username === "string" && m.username.trim().length > 0,
    );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendLog = (msg: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "log", message: msg })}\n\n`));
      };
      const sendResult = (tasks: DraftTask[]) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "result", tasks })}\n\n`));
      };
      const sendError = (err: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: err })}\n\n`));
      };

      try {
        sendLog("Initializing task parsing...");
        sendLog(`Using destination context: ${destination}`);
        sendLog("Constructing prompt for Gemini API...");

        const rosterLine = roster.length > 0
          ? `People on this trip: ${roster.map((m) => m.username).join(", ")}`
          : "The roster of people on this trip was not supplied.";
        const whoIsAsking = self ? `${self} is writing.` : "";

        const systemInstruction = `You are a travel task extractor for a group trip planning app.
Your ONLY job: read a message from a trip group member and return a JSON array of tasks.
You MUST always return a JSON array. Never return empty if the message clearly mentions something unbooked or unresolved.
Output format: [{"title":"Short action phrase","description":"One sentence of context","assignee":null}]
Rules: max ${MAX_TASKS} tasks, no prose, no markdown, no code fences — just the raw JSON array.
"assignee" must be either null or EXACTLY one of the usernames listed below, spelled the same way. Never invent a name, never use a first name that is not listed, never assign a task to the person who is not mentioned. Leave it null unless the message clearly names someone who should do it.
${rosterLine}
${whoIsAsking}`;

        const userPrompt = `Trip destination: ${destination}

Member's message: "${message.trim()}"

The message above mentions things that haven't been done yet. Extract each one as a task.
Examples of tasks to extract:
- "hotel/accommodation not booked" → {"title":"Book accommodation","description":"Research and book a hotel for the group.","assignee":null}
- "flights not booked" → {"title":"Book flights","description":"Find and book return flights for all members.","assignee":null}
- "sort out food spots" → {"title":"Research food spots","description":"Find recommended restaurants and food spots to visit.","assignee":null}

Return the JSON array now:`;

        sendLog("Calling Gemini API streamGenerateContent...");

        const geminiBody = JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
          },
        });

        let geminiRes: Response | null = null;
        const perModel: string[] = [];

        for (const model of GEMINI_MODELS) {
          try {
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(45_000),
                body: geminiBody,
              }
            );

            if (res.ok) {
              geminiRes = res;
              perModel.push(`${model}: ok`);
              break;
            }

            // 404/403 is permanent for this key; 503/429 is capacity and worth
            // a second try before moving on.
            const permanent = res.status === 404 || res.status === 403;
            const transient = res.status === 503 || res.status === 429;
            perModel.push(
              `${model}: ${res.status}${permanent ? " (unavailable)" : transient ? " (overloaded)" : ""}`
            );
            sendLog(`Model ${model} returned ${res.status}, trying next...`);
            if (!transient) continue;

            await new Promise((resolve) => setTimeout(resolve, 1500));
            const retry = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(45_000),
                body: geminiBody,
              }
            );
            if (retry.ok) {
              geminiRes = retry;
              perModel.push(`${model}: ok on retry`);
              break;
            }
            perModel.push(`${model}: ${retry.status} on retry`);
          } catch (err) {
            perModel.push(`${model}: exception ${String(err).slice(0, 60)}`);
          }
        }

        if (!geminiRes) {
          sendError(
            `Gemini unavailable across ${GEMINI_MODELS.length} models. Per-model: ${perModel.join(" | ")}`
          );
          controller.close();
          return;
        }

        sendLog(`Streaming from Gemini (${perModel[perModel.length - 1]})...`);
        let rawText = "";
        let buffer = "";

        const reader = geminiRes.body!.getReader();
        const decoder = new TextDecoder();

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;

          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = drainSseEvents(buffer);
          buffer = rest;

          for (const event of events) {
            const rec = event as Record<string, any>;
            const textChunk = rec?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (textChunk) {
              rawText += textChunk;
              sendLog(`Received AI chunk: ${textChunk.replace(/\n/g, "\\n")}`);
            }
          }
        }

        sendLog("Finished receiving AI response.");
        sendLog("Parsing JSON tasks from response...");

        if (!rawText) {
          sendError("Gemini returned no text.");
          controller.close();
          return;
        }

        // The model's `assignee` is a guess read out of a prompt. Only names
        // that are actually on this trip's roster survive; anything invented
        // becomes null, which the client writes as an open task. A dropped
        // assignment is recoverable, a task owned by a stranger is not.
        const rosterNames = new Set(roster.map((m) => m.username.trim().toLowerCase()));

        const sanitize = (arr: unknown[]): DraftTask[] =>
          arr
            .filter((t): t is Record<string, unknown> => {
              if (typeof t !== "object" || t === null) return false;
              const rec = t as Record<string, unknown>;
              return typeof rec.title === "string" && rec.title.trim().length > 0;
            })
            .map((t) => {
              const raw = typeof t.assignee === "string" ? t.assignee.trim() : "";
              return {
                title: String(t.title).trim(),
                description: typeof t.description === "string" ? t.description.trim() : "",
                assignee: raw && rosterNames.has(raw.toLowerCase()) ? raw : null,
              };
            })
            .slice(0, MAX_TASKS);

        let tasks: DraftTask[] = [];
        const cleaned = rawText.trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        try {
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed)) {
            tasks = sanitize(parsed);
          }
        } catch {
          const lastCloseBrace = cleaned.lastIndexOf("}");
          if (lastCloseBrace !== -1) {
            try {
              const repaired = cleaned.slice(0, lastCloseBrace + 1) + "]";
              const parsed = JSON.parse(repaired);
              if (Array.isArray(parsed)) {
                tasks = sanitize(parsed);
              }
            } catch {
              // strategy 3
            }
          }
          if (tasks.length === 0) {
            const itemRegex =
              /"title"\s*:\s*"([^"]+)"(?:\s*,\s*"description"\s*:\s*"([^"]*)")?(?:\s*,\s*"assignee"\s*:\s*(?:"([^"]*)"|null))?/g;
            const matched: DraftTask[] = [];
            let match;
            while ((match = itemRegex.exec(cleaned)) !== null) {
              const who = (match[3] || "").trim();
              matched.push({
                title: match[1].trim(),
                description: (match[2] || "").trim(),
                assignee: who && rosterNames.has(who.toLowerCase()) ? who : null,
              });
            }
            tasks = matched.slice(0, MAX_TASKS);
          }
        }

        sendLog(`Parsed ${tasks.length} tasks successfully.`);
        sendResult(tasks);
        controller.close();
      } catch (err) {
        sendError(String(err));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
});