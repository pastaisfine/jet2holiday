import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Closed category enum (Q18) — hardcoded category → styleHint mapping.
// styleHint is metadata-only this session; consumed by PlanScreen in a future slice.
const CATEGORY_TO_STYLE: Record<string, string> = {
  food: "foodfirst",
  culture: "balanced",
  nature: "slower",
  shopping: "balanced",
  nightlife: "balanced",
  wellness: "slower",
};
const CATEGORIES = Object.keys(CATEGORY_TO_STYLE);

interface LocationSuggestion {
  name: string;
  category: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  const SERP_API_KEY = Deno.env.get("SERP_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!GEMINI_API_KEY || !SERP_API_KEY) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY or SERP_API_KEY not configured" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  // Q34: verify JWT server-side, derive userId from token — body userId ignored.
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let userId: string;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const userData = await userRes.json();
    userId = userData.id;
    if (!userId) throw new Error("no user id");
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let body: {
    destination?: string;
    startDate?: string | null;
    endDate?: string | null;
    preferences?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const destination = (body.destination || "").trim();
  if (!destination) {
    return new Response(JSON.stringify({ error: "destination is required" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        const prefs = body.preferences || {};
        const prefLines = [
          prefs.rhythm ? `Travel rhythm: ${prefs.rhythm}` : "",
          prefs.density ? `Itinerary density: ${prefs.density}` : "",
          prefs.dining ? `Dining style: ${prefs.dining}` : "",
          prefs.foodBudget ? `Food budget: ${prefs.foodBudget}` : "",
          Array.isArray(prefs.dietary) && prefs.dietary.length ? `Dietary needs: ${prefs.dietary.join(", ")}` : "",
          prefs.note ? `Extra note: ${prefs.note}` : "",
        ].filter(Boolean).join("\n");

        const tripLength = body.startDate && body.endDate
          ? Math.max(1, Math.round((new Date(body.endDate).getTime() - new Date(body.startDate).getTime()) / 86400000))
          : null;

        const systemInstruction = `You are the Tripder Itinerary Agent. Your ONLY job: given a travel destination, return a JSON array of the best places to visit there.
Output format: [{"name":"Place name","category":"one of: ${CATEGORIES.join(", ")}"}]
Rules:
- Return between 6 and 19 locations. Pick the count based on how much the destination offers (a small town → ~6, a world city → ~15).
- Each category MUST be exactly one of: ${CATEGORIES.join(", ")}.
- Prefer area-level, well-known, real places (landmarks, neighborhoods, markets, viewpoints) over obscure or hyper-specific spots.
- No prose, no markdown, no code fences — just the raw JSON array.`;

        const userPrompt = `Destination: ${destination}
${tripLength ? `Trip length: ${tripLength} day${tripLength === 1 ? "" : "s"}` : ""}
${prefLines ? `Traveller preferences:\n${prefLines}` : ""}

Return the JSON array of locations now:`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemInstruction }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
            }),
          }
        );

        if (!geminiRes.ok) {
          const errBody = await geminiRes.text();
          send({ type: "error", message: `Gemini API error ${geminiRes.status}: ${errBody.slice(0, 500)}` });
          controller.close();
          return;
        }

        let rawText = "";
        const reader = geminiRes.body!.getReader();
        const decoder = new TextDecoder();
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const dataStr = line.slice(6).trim();
              if (!dataStr || dataStr === "[DONE]") continue;
              try {
                const data = JSON.parse(dataStr);
                const textChunk = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                if (textChunk) rawText += textChunk;
              } catch {
                // ignore incomplete SSE chunk
              }
            }
          }
        }

        if (!rawText) {
          send({ type: "error", message: "Gemini returned no text." });
          controller.close();
          return;
        }

        const sanitize = (arr: unknown[]): LocationSuggestion[] =>
          arr
            .filter((t): t is Record<string, unknown> =>
              typeof t === "object" && t !== null &&
              typeof (t as Record<string, unknown>).name === "string" &&
              ((t as Record<string, unknown>).name as string).trim().length > 0
            )
            .map((t) => {
              const rawCat = typeof t.category === "string" ? t.category.trim().toLowerCase() : "";
              return {
                name: String(t.name).trim(),
                category: CATEGORIES.includes(rawCat) ? rawCat : "culture",
              };
            })
            .slice(0, 19);

        let locations: LocationSuggestion[] = [];
        const cleaned = rawText.trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        try {
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed)) locations = sanitize(parsed);
        } catch {
          const first = cleaned.indexOf("[");
          const last = cleaned.lastIndexOf("]");
          if (first !== -1 && last > first) {
            try {
              const parsed = JSON.parse(cleaned.slice(first, last + 1));
              if (Array.isArray(parsed)) locations = sanitize(parsed);
            } catch {
              // fall through
            }
          }
        }

        if (locations.length === 0) {
          send({ type: "error", message: "Could not parse location list from Gemini response." });
          controller.close();
          return;
        }

        // Emit the raw location list first so the client can render progress.
        send({
          type: "locations",
          locations: locations.map((l) => ({
            ...l,
            styleHint: CATEGORY_TO_STYLE[l.category] || "balanced",
          })),
        });

        // Enrich each location via SerpApi google_maps_search (Q9). Drop failures silently (Q17).
        let enrichedCount = 0;
        for (const loc of locations) {
          try {
            const params = new URLSearchParams({
              engine: "google_maps",
              q: `${loc.name}, ${destination}`,
              type: "search",
              api_key: SERP_API_KEY,
            });
            const res = await fetch(`https://serpapi.com/search.json?${params}`);
            if (!res.ok) continue;
            const data = await res.json();
            const result = data?.local_results?.[0] || data?.place_results;
            if (!result) continue;

            const lat = result?.gps_coordinates?.latitude;
            const lng = result?.gps_coordinates?.longitude;
            if (typeof lat !== "number" || typeof lng !== "number") continue;

            enrichedCount += 1;
            send({
              type: "enriched",
              location: {
                name: result.title || loc.name,
                lat,
                lng,
                placeId: result.place_id || "",
                thumbnail: result.thumbnail || "",
                rating: typeof result.rating === "number" ? result.rating : null,
                address: result.address || "",
                category: loc.category,
                styleHint: CATEGORY_TO_STYLE[loc.category] || "balanced",
              },
            });
          } catch {
            // Q17: drop failed enrichment silently
            continue;
          }
        }

        send({ type: "done", count: enrichedCount });
        controller.close();
      } catch (err) {
        send({ type: "error", message: String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
