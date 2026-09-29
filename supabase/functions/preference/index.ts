import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Swipe = {
  card_name?: string;
  direction?: string;
  reasons?: string[];
};

type Profile = {
  username?: string;
  rhythm?: string;
  density?: string;
  dining?: string;
  foodBudget?: string;
  dietary?: string[];
  preferenceNote?: string;
  travelStyle?: string;
};

type PreferenceSummary = {
  styleName: string;
  tagline: string;
  interests: string[];
  dislikes: string[];
  pace: string;
  diningPreference: string;
  budgetPreference: string;
  dietaryConstraints: string[];
  priorities: string[];
  constraints: string[];
  reasoningInsights: string[];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const headers = {
    ...CORS,
    "Content-Type": "application/json",
  };

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "GEMINI_API_KEY is not configured on this server",
      }),
      {
        status: 500,
        headers,
      }
    );
  }

  let body: {
    profile?: Profile;
    initialPreferences?: Record<string, unknown>;
    destination?: string;
    swipes?: Swipe[];
  };

  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({
        error: "Invalid JSON body",
      }),
      {
        status: 400,
        headers,
      }
    );
  }

  try {
    const profile = body?.profile ?? {};
    const initialPreferences = body?.initialPreferences ?? {};
    const destination = body?.destination || "unknown destination";
    const swipes = Array.isArray(body?.swipes) ? body.swipes : [];

    if (
      swipes.length === 0 &&
      Object.keys(initialPreferences).length === 0
    ) {
      return new Response(
        JSON.stringify({
          error: "No preference data was provided.",
        }),
        {
          status: 400,
          headers,
        }
      );
    }

    const normalizedSwipes = swipes
      .filter((swipe) => swipe && typeof swipe === "object")
      .map((swipe) => ({
        card_name:
          typeof swipe.card_name === "string"
            ? swipe.card_name.trim()
            : "",
        direction:
          swipe.direction === "like" || swipe.direction === "skip"
            ? swipe.direction
            : "unknown",
        reasons: Array.isArray(swipe.reasons)
          ? swipe.reasons
              .filter((reason) => typeof reason === "string")
              .map((reason) => reason.trim())
              .filter(Boolean)
          : [],
      }))
      .filter((swipe) => swipe.card_name.length > 0);

    const systemInstruction = `
You are the Preference Agent for a group travel planning application.

Your job is to analyse ONE traveller's:
1. profile preferences,
2. initial travel preferences,
3. swipe decisions,
4. reasons behind those swipe decisions.

Identify the traveller's actual travel interests, dislikes, priorities,
preferences and constraints.

You MUST return exactly one JSON object.

Create a memorable 2–4 word travel style title summarising this person's travel personality.

Output schema:

{
  "styleName": string,
  "tagline": string,
  "interests": string[],
  "dislikes": string[],
  "pace": string,
  "diningPreference": string,
  "budgetPreference": string,
  "dietaryConstraints": string[],
  "priorities": string[],
  "constraints": string[],
  "reasoningInsights": string[]
}

Rules:
- Use evidence from both the initial preferences and swipe reasons.
- Swipe reasons are signals, not absolute truth.
- styleName should be a memorable 2–4 word travel identity.
- tagline should be a one-sentence description explaining why this style fits the traveller.
- Repeated patterns should have more weight than a single swipe.
- Distinguish preferences from hard constraints.
- Do not invent preferences that are unsupported by the input.
- Keep each array concise and useful for downstream group planning.
- "constraints" should contain genuine limitations such as dietary restrictions,
  budget limits or strong activity exclusions.
- "priorities" should contain things the traveller values when making trade-offs.
- "reasoningInsights" should contain short evidence-based observations.
- Return valid JSON only.
- No markdown.
- No explanation outside the JSON object.
`;

    const userPrompt = `
Destination:
${destination}

User profile:
${JSON.stringify(profile, null, 2)}

Initial preferences:
${JSON.stringify(initialPreferences, null, 2)}

Swipe decisions:
${JSON.stringify(normalizedSwipes, null, 2)}

Analyse this traveller's preferences and return the required JSON object.
`;

    // ------------------------------------------------------------
    // Gemini API request with model fallback and backoff retry
    // ------------------------------------------------------------

    const requestBody = {
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    };

    // Same ordering as generate-trip, from a live probe of this project's key
    // (2026-09-29):
    //   gemini-3.5-flash         200, ~2.5s  — works
    //   gemini-flash-lite-latest 200, ~0.9s  — works, fastest
    //   gemini-3.6-flash         503 overloaded
    //   gemini-flash-latest      hangs past 25s
    //   gemini-3.1-pro-preview   429, separate tier with no quota on this plan
    //
    // This function used to hardcode gemini-3.6-flash, which is the one
    // currently overloaded — so it failed on every call with no way to recover.
    const GEMINI_MODELS = [
      "gemini-3.5-flash",
      "gemini-flash-lite-latest",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
      "gemini-flash-latest",
    ];

    const MAX_ATTEMPTS = 2;

    const RETRYABLE_STATUS_CODES = new Set([
      408,
      429,
      500,
      502,
      503,
      504,
    ]);

    const perModel: string[] = [];
    let geminiData: any = null;
    let lastErrBody = "";

    for (const model of GEMINI_MODELS) {
      let lastStatus = "no attempt";

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(45_000),
              body: JSON.stringify(requestBody),
            }
          );

          if (geminiRes.ok) {
            geminiData = await geminiRes.json();
            const text =
              geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (text.trim().length > 0) {
              perModel.push(`${model}: ok`);
              console.log(`[Preference Agent] Analysed via ${model}`);
              break;
            }
            lastStatus = "returned an empty response";
          } else {
            lastErrBody = await geminiRes.text();
            console.error(
              `[Preference Agent] ${model} attempt ${attempt}: ` +
                `${geminiRes.status} ${lastErrBody.slice(0, 160)}`
            );

            // 404/403 means this key cannot use this model at all, so move on
            // immediately rather than burning retries on a permanent condition.
            if (geminiRes.status === 404 || geminiRes.status === 403) {
              lastStatus = `unavailable to this key (${geminiRes.status})`;
              break;
            }

            if (RETRYABLE_STATUS_CODES.has(geminiRes.status)) {
              lastStatus = `overloaded after ${attempt} attempt(s) (${geminiRes.status})`;
              if (attempt < MAX_ATTEMPTS) {
                const delay = 1000 * Math.pow(2, attempt - 1);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
              }
              break;
            }

            lastStatus = `error ${geminiRes.status}`;
            break;
          }
        } catch (networkError) {
          console.error(
            `[Preference Agent] ${model} network error on attempt ${attempt}:`,
            networkError
          );
          lastStatus = `exception: ${String(networkError).slice(0, 80)}`;
        }
      }

      if (geminiData) break;
      perModel.push(`${model}: ${lastStatus}`);
      console.warn(
        `[Preference Agent] Model ${model} exhausted retries: ${lastStatus}`
      );
    }

    if (!geminiData) {
      return new Response(
        JSON.stringify({
          error:
            `Gemini unavailable across ${GEMINI_MODELS.length} models. ` +
            `Per-model: ${perModel.join(" | ")}. ` +
            `Last response: ${lastErrBody.slice(0, 300)}`,
        }),
        {
          status: 502,
          headers,
        }
      );
    }

    // ------------------------------------------------------------
    // Parse Gemini response
    // ------------------------------------------------------------

    const rawText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!rawText) {
      return new Response(
        JSON.stringify({
          error: "Gemini returned no preference analysis.",
        }),
        {
          status: 502,
          headers,
        }
      );
    }

    let parsed: Partial<PreferenceSummary>;

    try {
      parsed = JSON.parse(rawText);
    } catch {
      return new Response(
        JSON.stringify({
          error: "Gemini returned invalid JSON.",
        }),
        {
          status: 502,
          headers,
        }
      );
    }

    const toStringArray = (value: unknown): string[] => {
      if (!Array.isArray(value)) return [];

      return value
        .filter(
          (item): item is string =>
            typeof item === "string"
        )
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 10);
    };

    const summary: PreferenceSummary = {
      styleName:
        typeof parsed.styleName === "string"
          ? parsed.styleName.trim()
          : "Curious Explorer",

      tagline:
        typeof parsed.tagline === "string"
          ? parsed.tagline.trim()
          : "Your travel personality is inferred from your preferences and swipe decisions.",

      interests: toStringArray(parsed.interests),

      dislikes: toStringArray(parsed.dislikes),

      pace:
        typeof parsed.pace === "string"
          ? parsed.pace.trim()
          : "",

      diningPreference:
        typeof parsed.diningPreference === "string"
          ? parsed.diningPreference.trim()
          : "",

      budgetPreference:
        typeof parsed.budgetPreference === "string"
          ? parsed.budgetPreference.trim()
          : "",

      dietaryConstraints: toStringArray(
        parsed.dietaryConstraints
      ),

      priorities: toStringArray(parsed.priorities),

      constraints: toStringArray(parsed.constraints),

      reasoningInsights: toStringArray(
        parsed.reasoningInsights
      ),
    };

    return new Response(
      JSON.stringify({
        summary,
        metadata: {
          destination,
          swipeCount: normalizedSwipes.length,
        },
      }),
      {
        status: 200,
        headers,
      }
    );
  } catch (err) {
    console.error("Preference Agent error:", err);

    return new Response(
      JSON.stringify({
        error:
          err instanceof Error
            ? err.message
            : String(err),
      }),
      {
        status: 500,
        headers,
      }
    );
  }
});