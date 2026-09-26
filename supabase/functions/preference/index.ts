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
    // Gemini API request with exponential backoff retry
    // ------------------------------------------------------------

    const GEMINI_URL =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;

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

    const MAX_ATTEMPTS = 4;

    const RETRYABLE_STATUS_CODES = new Set([
      408,
      429,
      500,
      502,
      503,
      504,
    ]);

    let geminiRes: Response | null = null;
    let lastErrBody = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        geminiRes = await fetch(GEMINI_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });
      } catch (networkError) {
        console.error(
          `[Preference Agent] Gemini network error on attempt ${attempt}:`,
          networkError
        );

        if (attempt === MAX_ATTEMPTS) {
          throw networkError;
        }

        const baseDelay = 1000 * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 500);
        const delay = baseDelay + jitter;

        console.log(
          `[Preference Agent] Retrying Gemini request in ${delay}ms...`
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (geminiRes.ok) {
        break;
      }

      lastErrBody = await geminiRes.text();

      console.error(
        `[Preference Agent] Gemini API error on attempt ${attempt}: ` +
          `${geminiRes.status} ${lastErrBody}`
      );

      const shouldRetry =
        RETRYABLE_STATUS_CODES.has(geminiRes.status) &&
        attempt < MAX_ATTEMPTS;

      if (!shouldRetry) {
        break;
      }

      const baseDelay = 1000 * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 500);
      const delay = baseDelay + jitter;

      console.log(
        `[Preference Agent] Gemini returned ${geminiRes.status}. ` +
          `Retrying in ${delay}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (!geminiRes) {
      return new Response(
        JSON.stringify({
          error: "Gemini request failed without a response.",
        }),
        {
          status: 502,
          headers,
        }
      );
    }

    if (!geminiRes.ok) {
      return new Response(
        JSON.stringify({
          error:
            `Gemini API error ${geminiRes.status}: ${lastErrBody}`,
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

    const geminiData = await geminiRes.json();

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