import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// The six-value category vocabulary, shared with CATEGORY_TO_STYLE in
// generate-trip. Duplicated here rather than imported because the two
// functions are deployed independently, and a wrong value is rejected on the
// way in anyway -- so drift surfaces as a dropped category, not a crash.
const CATEGORIES = [
  "food",
  "culture",
  "nature",
  "shopping",
  "nightlife",
  "wellness",
] as const;

type Swipe = {
  card_name?: string;
  direction?: string;
  // NULL in the DB and here: a user-added place has no category anywhere in
  // the system, so those swipes count toward totals but not the category tally.
  category?: string | null;
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

// Same cleanup as group-planner's stripJsonFence: the model occasionally wraps
// the JSON in a markdown fence or adds a preamble despite responseMimeType, so
// clean the text before parsing rather than failing the whole call on it.
function stripJsonFence(raw: string): string {
  let cleaned = raw.replace(/^```(?:json)?|```$/g, "").trim();
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const objStart = cleaned.indexOf("{");
    const arrStart = cleaned.indexOf("[");
    const start = objStart >= 0 && (arrStart < 0 || objStart < arrStart) ? objStart : arrStart;
    const end = start >= 0 && cleaned[start] === "{" ? cleaned.lastIndexOf("}") : cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  }
  return cleaned;
}

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
        // An unrecognised category becomes null rather than being passed
        // through: a value the model has not been told about is worse than a
        // gap it knows to discount.
        category: CATEGORIES.includes(
          swipe.category as (typeof CATEGORIES)[number]
        )
          ? swipe.category
          : null,
      }))
      .filter((swipe) => swipe.card_name.length > 0);

    // Category tallies, computed here rather than left to the model.
    //
    // A flash model at temperature 0.2 cannot reliably count 19 swipes into six
    // buckets, and a miscount would surface as a confident wrong claim like
    // "rejected all 3 food venues" when it was 1 of 3. Doing the arithmetic
    // deterministically costs a few dozen tokens and makes the pattern the
    // strongest thing in the prompt.
    const categoryTally = CATEGORIES.map((category) => {
      const matching = normalizedSwipes.filter(
        (swipe) => swipe.category === category
      );

      return {
        category,
        likes: matching.filter((swipe) => swipe.direction === "like").length,
        skips: matching.filter((swipe) => swipe.direction === "skip").length,
      };
    }).filter((row) => row.likes > 0 || row.skips > 0);

    const uncategorizedCount = normalizedSwipes.filter(
      (swipe) => swipe.category === null
    ).length;

    const systemInstruction = `
You are the Preference Agent for a group travel planning application.

Your job is to analyse ONE traveller's:
1. profile preferences,
2. initial travel preferences,
3. swipe decisions and the categories behind them.

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
- Use evidence from both the initial preferences and the category breakdown of
  the swipe decisions.
- A single swipe is a weak signal; the categories behind them are stronger.
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

Using the category evidence:
- The category tally below is precomputed and exact. Trust those numbers over
  your own reading of the swipe list, and quote them when you cite a pattern
  ("rejected all 3 food venues", not "seemed wary of food").
- A category where every swipe was a skip is a strong signal. One where every
  swipe was a like is a strong signal. A category split between the two is weak
  evidence, and one with a single swipe proves nothing on its own.
- "food" and "nightlife" are broad: a traveller who skipped two food venues has
  not rejected food. Say what the evidence covers ("skipped both market stalls",
  not "does not like food markets") unless the count genuinely supports the
  broader claim.
- Swipes with no category are missing data, not evidence of anything. Exclude
  them from any category claim rather than treating them as a seventh category.
- A traveller can like a place's neighbourhood while skipping what is in it.
  When the tally shows a liked card and a skipped card from the same area, the
  category split is the more useful read.
- Put category findings to work in the fields above. A category pattern belongs
  in "dislikes", "interests" or "priorities" backed by its count -- it is not a
  separate finding to be invented for.

Naming the traveller:
- styleName may only name a category the tally shows at least one LIKE for.
  A traveller who skipped every food venue is not a food person, whatever else
  their profile says.
- Prefer the categories with the most likes. If the tally is empty, name no
  category at all -- a neutral name is always better than an unfounded one.
- The client re-checks styleName against this same tally and replaces it with a
  neutral one if it fails, so an unsupported name is thrown away rather than
  shown. Do not pad the name with categories to sound interesting.
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

Category tally (precomputed, exact):
${JSON.stringify(categoryTally)}
Swipes with no category: ${uncategorizedCount} of ${normalizedSwipes.length}

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
        // 2048 was truncating longer summaries mid-JSON, which is unparseable
        // no matter how well the text is cleaned. Matches the other agents.
        maxOutputTokens: 4096,
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
    // A response only counts as a success once its text parses as a JSON
    // object. The old code accepted any non-empty text here and parsed after
    // the loop, so a fenced or truncated response from the first model 502'd
    // immediately and the four fallback models were never tried.
    let parsedSummary: Partial<PreferenceSummary> | null = null;
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
            const data = await geminiRes.json();
            const text =
              data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

            if (text.trim().length === 0) {
              lastStatus = "returned an empty response";
              continue;
            }

            try {
              const candidate: unknown = JSON.parse(stripJsonFence(text));
              if (
                candidate === null ||
                typeof candidate !== "object" ||
                Array.isArray(candidate)
              ) {
                throw new Error("response is not a JSON object");
              }
              parsedSummary = candidate as Partial<PreferenceSummary>;
            } catch {
              lastStatus = "returned unparseable JSON";
              console.warn(
                `[Preference Agent] ${model} attempt ${attempt}: ` +
                  `response did not parse as JSON (${text.length} chars)`
              );
              continue;
            }

            geminiData = data;
            perModel.push(`${model}: ok`);
            console.log(`[Preference Agent] Analysed via ${model}`);
            break;
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

    if (!geminiData || !parsedSummary) {
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

    const parsed: Partial<PreferenceSummary> = parsedSummary;

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
          // The tally is returned, not just rendered into the prompt, so the
          // numbers behind any claim in the summary can be checked later
          // without re-running the analysis.
          categoryTally,
          uncategorizedCount,
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