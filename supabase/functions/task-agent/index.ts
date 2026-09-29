import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY is not configured on this server" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendLog = (msg: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`));
      };
      const sendResult = (tasks: any[]) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', tasks })}\n\n`));
      };
      const sendError = (err: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err })}\n\n`));
      };

      try {
        sendLog("Initializing task parsing...");
        const message: string = body?.message ?? "";
        const tripContext: Record<string, string> = body?.tripContext ?? {};
        const debug: boolean = body?.debug === true;

        sendLog("Validating input message...");
        if (!message || typeof message !== "string" || message.trim().length === 0) {
          sendError("message is required and must be a non-empty string");
          controller.close();
          return;
        }

        const destination = tripContext?.destination || "their destination";
        sendLog(`Using destination context: ${destination}`);
        sendLog("Constructing prompt for Gemini API...");

        const systemInstruction = `You are a travel task extractor for a group trip planning app.
Your ONLY job: read a message from a trip group member and return a JSON array of tasks.
You MUST always return a JSON array. Never return empty if the message clearly mentions something unbooked or unresolved.
Output format: [{"title":"Short action phrase","description":"One sentence of context"}]
Rules: max 5 tasks, no prose, no markdown, no code fences — just the raw JSON array.`;

        const userPrompt = `Trip destination: ${destination}

Member's message: "${message.trim()}"

The message above mentions things that haven't been done yet. Extract each one as a task.
Examples of tasks to extract:
- "hotel/accommodation not booked" → {"title":"Book accommodation","description":"Research and book a hotel for the group."}
- "flights not booked" → {"title":"Book flights","description":"Find and book return flights for all members."}  
- "sort out food spots" → {"title":"Research food spots","description":"Find recommended restaurants and food spots to visit."}

Return the JSON array now:`;

        sendLog("Calling Gemini API streamGenerateContent...");

        // Same ordering as generate-trip and preference, from a live probe of
        // this project's key (2026-09-29):
        //   gemini-3.5-flash         200, ~2.5s  — works
        //   gemini-flash-lite-latest 200, ~0.9s  — works, fastest
        //   gemini-3.6-flash         503 overloaded
        //   gemini-flash-latest      hangs past 25s
        //   gemini-3.1-pro-preview   429, separate tier with no quota on this plan
        //
        // This used to hardcode gemini-3.6-flash, the one currently overloaded,
        // so task parsing failed on every call.
        const GEMINI_MODELS = [
          "gemini-3.5-flash",
          "gemini-flash-lite-latest",
          "gemini-3.6-flash",
          "gemini-3.8-flash",
        ];

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

        const reader = geminiRes.body!.getReader();
        const decoder = new TextDecoder();
        let done = false;
        
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.slice(6).trim();
                if (dataStr === '[DONE]') continue;
                if (!dataStr) continue;
                try {
                  const data = JSON.parse(dataStr);
                  const textChunk = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                  if (textChunk) {
                    rawText += textChunk;
                    sendLog(`Received AI chunk: ${textChunk.replace(/\n/g, '\\n')}`);
                  }
                } catch (e) {
                  // ignore parse error for incomplete SSE chunk
                }
              }
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

        const sanitize = (arr: unknown[]) =>
          arr
            .filter((t): t is { title: string; description?: string } => {
              // Narrow via a local rather than touching properties on the
              // `object` type, which cannot be indexed directly.
              if (typeof t !== "object" || t === null) return false;
              const rec = t as Record<string, unknown>;
              return typeof rec.title === "string" && rec.title.trim().length > 0;
            })
            .map((t) => ({
              title: String(t.title).trim(),
              description: typeof t.description === "string" ? t.description.trim() : "",
            }))
            .slice(0, 5);

        let tasks: { title: string; description: string }[] = [];
        let cleaned = rawText.trim()
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
            const itemRegex = /"title"\s*:\s*"([^"]+)"(?:\s*,\s*"description"\s*:\s*"([^"]*)")?/g;
            const matchedTasks: { title: string; description: string }[] = [];
            let match;
            while ((match = itemRegex.exec(cleaned)) !== null) {
              matchedTasks.push({
                title: match[1].trim(),
                description: (match[2] || "").trim(),
              });
            }
            tasks = matchedTasks.slice(0, 5);
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
