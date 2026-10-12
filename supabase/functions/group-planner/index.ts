import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CATEGORIES = [
  "food",
  "culture",
  "nature",
  "shopping",
  "nightlife",
  "wellness",
] as const;

type Category = (typeof CATEGORIES)[number];

const PHOTO_BUCKET = "trip-photos";
const EVIDENCE_CAP = 12;
const MIN_STOPS_PER_DAY = 2;
const MAX_STOPS_PER_DAY = 6;

// Same ordering as generate-trip, from a live probe of this project's key.
const GEMINI_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash",
];

const GEMINI_TIMEOUT_MS = 45_000;
const GEMINI_PER_MODEL_ATTEMPTS = 2;

type SummaryRow = {
  user_id: string;
  style_name: string;
  tagline: string;
  interests: string[];
  dislikes: string[];
  pace: string;
  dining_preference: string;
  budget_preference: string;
  dietary_constraints: string[];
  priorities: string[];
  constraints: string[];
  reasoning_insights: string[];
  swipe_count: number;
};

type CardRow = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  estimated_duration_min: number | null;
  rating: number | null;
  review_count: number | null;
  address_or_area: string | null;
  latitude: number | null;
  longitude: number | null;
  thumbnail_url: string | null;
  img_storage_path: string | null;
};

type SwipeRow = {
  user_id: string;
  card_name: string;
  direction: string;
  category: string | null;
};

type Member = {
  user_id: string;
  role: string;
  username: string;
};

type GroupProfile = {
  group_priorities: string[];
  group_conflicts: {
    topic: string;
    members_a: string[];
    members_b: string[];
    resolution: string;
  }[];
  hard_constraints: string[];
  recommended_balance: Record<string, string>;
  // Derived deterministically from the members' paces, not asked of the model.
  // The scheduler uses it to pick start-of-day and stop length.
  trip_style: string;
};

type PlanStop = {
  card_id: string;
  name: string;
  category: string;
  area: string;
  description: string;
  img: string;
  lat: number | null;
  lng: number | null;
  estimated_duration_min: number | null;
  rating: number | null;
  why: string;
};

type PlanDay = {
  day_index: number;
  date: string | null;
  title: string;
  transport_mode: "walking" | "driving";
  stops: PlanStop[];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function resolveSecretKey(): string | null {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (parsed?.default) return parsed.default;
    } catch {
      // Malformed JSON falls through to the legacy key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

/** Minimal PostgREST client bound to the service role, which bypasses RLS. */
function adminClient(supabaseUrl: string, secretKey: string) {
  const headers = {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };

  const get = async (path: string) => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return await res.json();
  };

  return {
    headers,
    get,
    async upsertPlan(row: Record<string, unknown>) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/trip_plans?on_conflict=trip_id`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "resolution=merge-duplicates,return=representation",
          },
          body: JSON.stringify(row),
        },
      );
      if (!res.ok) {
        throw new Error(`Plan upsert failed: ${res.status} ${await res.text().catch(() => "")}`);
      }
      return (await res.json())?.[0] ?? null;
    },
    async updatePlan(tripId: string, patch: Record<string, unknown>) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/trip_plans?trip_id=eq.${encodeURIComponent(tripId)}`,
        { method: "PATCH", headers, body: JSON.stringify(patch) },
      );
      if (!res.ok) {
        console.warn(`[group-planner] Plan update failed: ${res.status} ${await res.text().catch(() => "")}`);
        return false;
      }
      return true;
    },
    async updateTrip(tripId: string, patch: Record<string, unknown>) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/trips?id=eq.${encodeURIComponent(tripId)}`,
        { method: "PATCH", headers, body: JSON.stringify(patch) },
      );
      if (!res.ok) {
        console.warn(`[group-planner] Trip update failed: ${res.status} ${await res.text().catch(() => "")}`);
        return false;
      }
      return true;
    },
  };
}

/**
 * Calls Gemini with model fallback and bounded retries, returning the raw
 * text of the first non-empty answer. Throws with a per-model diagnostic when
 * every model fails, so a failure report says whether the cause was quota,
 * availability, or capacity.
 */
async function callGemini(
  apiKey: string,
  systemInstruction: string,
  userPrompt: string,
  maxOutputTokens: number,
): Promise<string> {
  const perModel: string[] = [];
  let lastErrorBody = "";

  for (const model of GEMINI_MODELS) {
    let lastStatus = "no attempt";

    for (let attempt = 1; attempt <= GEMINI_PER_MODEL_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemInstruction }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens,
                responseMimeType: "application/json",
              },
            }),
          },
        );

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          lastErrorBody = body;
          console.warn(`[group-planner] ${model} attempt ${attempt}: ${res.status} ${body.slice(0, 160)}`);

          const quota = res.status === 429 && body.toLowerCase().includes("billing");
          if (res.status === 404 || res.status === 403 || quota) {
            lastStatus = `${res.status === 429 ? "out of quota" : "unavailable"} (${res.status})`;
            break;
          }
          if (res.status === 429 || res.status === 503 || res.status === 500) {
            lastStatus = `overloaded after ${attempt} attempt(s) (${res.status})`;
            if (attempt < GEMINI_PER_MODEL_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
              continue;
            }
            break;
          }
          lastStatus = `error ${res.status}`;
          break;
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (text.trim().length > 0) {
          console.log(`[group-planner] Gemini answered via ${model}`);
          return text;
        }
        lastStatus = "returned an empty response";
      } catch (err) {
        lastStatus = `exception: ${String(err).slice(0, 80)}`;
        console.warn(`[group-planner] ${model} attempt ${attempt} threw:`, err);
      }
    }

    if (lastStatus.startsWith("out of quota") || lastStatus.startsWith("unavailable")) {
      perModel.push(`${model}: ${lastStatus}`);
      continue;
    }
    perModel.push(`${model}: ${lastStatus}`);
  }

  throw new Error(
    `Gemini unavailable across ${GEMINI_MODELS.length} models. ` +
      `Per-model: ${perModel.join(" | ")}. Last response: ${lastErrorBody.slice(0, 300)}`,
  );
}

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

function toStringArray(value: unknown, cap = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, cap);
}

function categoryOf(card: CardRow): Category {
  return CATEGORIES.includes(card.category as Category) ? (card.category as Category) : "culture";
}

function photoUrl(supabaseUrl: string, card: CardRow): string {
  if (card.img_storage_path) {
    return `${supabaseUrl}/storage/v1/object/public/${PHOTO_BUCKET}/${card.img_storage_path}`;
  }
  return card.thumbnail_url || "";
}

function deriveTripStyle(summaries: SummaryRow[]): string {
  const paces = summaries.map((s) => (s.pace || "").toLowerCase()).filter(Boolean);
  if (paces.length === 0) return "balanced";

  const slow = paces.filter((p) => p.includes("slow") || p.includes("relax") || p.includes("leisur")).length;
  const fast = paces.filter((p) => p.includes("fast") || p.includes("packed") || p.includes("active")).length;

  if (slow >= Math.ceil(paces.length * 0.6)) return "relaxed";
  if (fast >= Math.ceil(paces.length * 0.6)) return "fast-paced";
  return "balanced";
}

const CATEGORY_LABELS: Record<Category, string> = {
  food: "Food",
  culture: "Attractions",
  nature: "Nature",
  shopping: "Shopping",
  nightlife: "Nightlife",
  wellness: "Wellness",
};

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  food: ["food", "cuisine", "dining", "eat", "restaurant", "street food", "brunch"],
  culture: ["culture", "history", "museum", "landmark", "temple", "heritage", "architecture"],
  nature: ["nature", "park", "outdoor", "hike", "beach", "garden", "waterfall", "island"],
  shopping: ["shopping", "market", "mall", "boutique", "souvenir"],
  nightlife: ["nightlife", "bar", "night", "party", "club"],
  wellness: ["wellness", "spa", "relax", "massage", "yoga"],
};

function labelFor(category: string): string {
  return CATEGORIES.includes(category as Category)
    ? CATEGORY_LABELS[category as Category]
    : "Attractions";
}

/**
 * Deterministic "Why this plan?" answers, computed from the same tallies the
 * agents trust. The model writes per-stop `why` lines; these aggregate reasons
 * are counted, not generated, so the summary card can never disagree with the
 * evidence underneath it.
 */
function buildRationale(args: {
  summaries: SummaryRow[];
  memberCount: number;
  cardTally: { name: string; likes: string[]; skips: string[] }[];
  groupProfile: GroupProfile;
  days: PlanDay[];
}): { bullets: string[]; days: Record<string, string> } {
  const { summaries, memberCount, cardTally, groupProfile, days } = args;
  const bullets: string[] = [];

  const memberCategoryCount = new Map<Category, number>();
  for (const category of CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[category];
    const count = summaries.filter((summary) => {
      const text = [...(summary.interests || []), ...(summary.priorities || [])]
        .join(" ")
        .toLowerCase();
      return keywords.some((keyword) => text.includes(keyword));
    }).length;
    memberCategoryCount.set(category, count);
  }

  const topCategories = [...memberCategoryCount.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [category, count] of topCategories.slice(0, 2)) {
    if (count >= 2 || memberCount === 1) {
      bullets.push(
        `${CATEGORY_LABELS[category]} was a priority for ${count} of ${memberCount} travellers.`,
      );
    }
  }

  const moderate = summaries.filter((summary) => {
    const pace = (summary.pace || "").toLowerCase();
    return !pace.includes("fast") && !pace.includes("packed");
  }).length;
  if (memberCount > 1 && moderate >= Math.ceil(memberCount / 2)) {
    bullets.push(`${moderate} of ${memberCount} travellers preferred a moderate pace.`);
  }

  const topCard = cardTally.find((row) => row.likes.length >= 2);
  if (topCard) {
    bullets.push(`${topCard.name} was highly preferred by ${topCard.likes.length} travellers.`);
  }

  const conflict = groupProfile.group_conflicts[0];
  if (conflict) {
    bullets.push(`${conflict.topic} split the group — resolved with: ${conflict.resolution}`);
  }

  const dayNotes: Record<string, string> = {};
  const priorityLabels = topCategories.slice(0, 2).map(([category]) => CATEGORY_LABELS[category]);
  for (const day of days) {
    const labels = [...new Set(day.stops.map((stop) => labelFor(stop.category)))];
    const parts: string[] = [];
    if (labels.length > 0) {
      parts.push(`Built around ${labels.slice(0, 3).join(", ")}`);
      if (labels.some((label) => priorityLabels.includes(label))) {
        parts.push("matching the group's shared priorities");
      }
    }
    const liked = day.stops.find((stop) =>
      cardTally.some((row) => row.name === stop.name && row.likes.length >= 2)
    );
    if (liked) {
      const likes = cardTally.find((row) => row.name === liked.name)?.likes.length ?? 0;
      parts.push(`includes ${liked.name}, liked by ${likes}`);
    }
    dayNotes[String(day.day_index)] = parts.length > 0 ? `${parts.join(", ")}.` : "";
  }

  return { bullets: bullets.slice(0, 5), days: dayNotes };
}

/** Max activities per day, if the planner stated one; clamped to safety bounds. */
function maxStopsPerDay(groupProfile: GroupProfile): number {
  for (const constraint of groupProfile.hard_constraints || []) {
    const match = String(constraint).match(/(\d+)\s*(?:activities|stops|places)\s*(?:per day|\/day)?/i);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (Number.isFinite(n)) return Math.min(Math.max(n, MIN_STOPS_PER_DAY), 8);
    }
    const maxMatch = String(constraint).match(/max(?:imum)?\s*(?:of\s*)?(\d+)/i);
    if (maxMatch) {
      const n = Number.parseInt(maxMatch[1], 10);
      if (Number.isFinite(n)) return Math.min(Math.max(n, MIN_STOPS_PER_DAY), 8);
    }
  }
  return MAX_STOPS_PER_DAY;
}

function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SECRET_KEY = resolveSecretKey();

  if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY not configured" }, 500);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json({ error: "Supabase credentials not configured" }, 500);
  }
  if (!SECRET_KEY) return json({ error: "No service-role key available" }, 500);

  // Verify the JWT server-side and derive the caller from it; the body is
  // never trusted for identity. Mirrors generate-trip.
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Unauthorized" }, 401);

  let userId: string;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) return json({ error: "Unauthorized" }, 401);
    const userData = await userRes.json();
    userId = userData.id;
    if (!userId) throw new Error("no user id");
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { tripId?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const tripId = (body.tripId || "").trim();
  const force = Boolean(body.force);
  if (!tripId) return json({ error: "tripId is required" }, 400);

  const admin = adminClient(SUPABASE_URL, SECRET_KEY);

  try {
    // Membership is checked before anything else: a non-member must not be
    // able to read summaries or trigger a generation for someone else's trip.
    const memberships = await admin.get(
      `trip_members?trip_id=eq.${encodeURIComponent(tripId)}&select=user_id,role`,
    ) as { user_id: string; role: string }[];

    if (!memberships.some((m) => m.user_id === userId)) {
      return json({ error: "You are not a member of this trip." }, 403);
    }

    const trips = await admin.get(
      `trips?id=eq.${encodeURIComponent(tripId)}&select=id,destination,start_date,end_date,leader_id`,
    ) as { id: string; destination: string; start_date: string | null; end_date: string | null; leader_id: string | null }[];

    const trip = trips[0];
    if (!trip) return json({ error: "Trip not found." }, 404);

    const existingPlans = await admin.get(
      `trip_plans?trip_id=eq.${encodeURIComponent(tripId)}&select=*`,
    ) as Record<string, unknown>[];
    const existing = existingPlans[0];

    if (
      existing?.status === "ready" &&
      existing?.candidate_pois &&
      !force
    ) {
      return json({ tripId, status: "ready", generated: false });
    }

    if (
      existing?.status === "pending" &&
      !force &&
      existing?.generated_by !== userId &&
      existing?.updated_at &&
      Date.now() - new Date(existing.updated_at as string).getTime() < 120_000
    ) {
      return json({ tripId, status: "pending", generated: false });
    }

    // Building (or rebuilding) the shared plan is the leader's call. `force`
    // must not become a way for any member to wipe a ready or confirmed plan.
    if (trip.leader_id !== userId) {
      return json({ error: "Only the trip creator can build the group plan." }, 403);
    }

    await admin.upsertPlan({
      trip_id: tripId,
      status: "pending",
      error_message: null,
      generated_by: userId,
    });

    // Freeze preferences the moment the build starts. The swipes trigger
    // enforces this server-side; the client hides the deck as a courtesy.
    await admin.updateTrip(tripId, { preferences_locked_at: new Date().toISOString() });

    const fail = async (message: string) => {
      console.error(`[group-planner] FAILED for trip ${tripId}: ${message}`);
      await admin.updatePlan(tripId, { status: "failed", error_message: message.slice(0, 500) });
      return json({ tripId, status: "failed", generated: true, error: message }, 200);
    };

    // ---- Layer 2: preference summaries -----------------------------------
    const summaries = await admin.get(
      `preference_summaries?trip_id=eq.${encodeURIComponent(tripId)}&select=*`,
    ) as SummaryRow[];

    if (summaries.length === 0) {
      return await fail("No member has completed their preference analysis yet.");
    }

    const profileRows = await admin.get(
      `profiles?id=in.(${memberships.map((m) => m.user_id).join(",")})&select=id,username`,
    ) as { id: string; username: string }[];

    const usernameById = new Map(profileRows.map((p) => [p.id, p.username || "Traveller"]));

    // Force-continue: only members with a completed preference analysis are
    // part of the plan. Everyone else stays a member -- they can read the plan
    // and vote on it -- but they contribute no evidence.
    const summaryByUser = new Map(summaries.map((s) => [s.user_id, s]));
    const members: Member[] = memberships
      .map((m, index) => ({
        user_id: m.user_id,
        role: m.role || "member",
        username: usernameById.get(m.user_id) || `Member ${index + 1}`,
      }))
      .filter((m) => summaryByUser.has(m.user_id));
    if (members.length === 0) {
      return await fail("No member has completed their preference analysis yet.");
    }

    // ---- Deck cards: the candidate pool ----------------------------------
    const deckLinks = await admin.get(
      `trip_deck_links?trip_id=eq.${encodeURIComponent(tripId)}&select=deck_id`,
    ) as { deck_id: string }[];
    const deckId = deckLinks[0]?.deck_id || null;

    let cards: CardRow[] = [];
    if (deckId) {
      cards = await admin.get(
        `trip_cards?deck_id=eq.${encodeURIComponent(deckId)}&select=id,name,category,description,estimated_duration_min,rating,review_count,address_or_area,latitude,longitude,thumbnail_url,img_storage_path&order=position.asc`,
      ) as CardRow[];
    }

    if (cards.length === 0) {
      return await fail("This trip has no swipe deck yet. Generate the deck first.");
    }

    // ---- Layer 3: relevant swipe evidence --------------------------------
    // Only swipes on cards that are in THIS trip's deck. The wider swipe
    // history belongs to the preference agent; the group planner needs the
    // evidence that is actually on the table.
    const deckNames = new Set(cards.map((c) => c.name));
    const swipes = await admin.get(
      `swipes?trip_id=eq.${encodeURIComponent(tripId)}&select=user_id,card_name,direction,category`,
    ) as SwipeRow[];

    const relevantSwipes = swipes.filter((s) => deckNames.has(s.card_name));
    const includedUserIds = new Set(members.map((m) => m.user_id));
    const includedSwipes = relevantSwipes.filter((s) => includedUserIds.has(s.user_id));

    const evidenceByUser = new Map<string, { liked: string[]; disliked: string[] }>();
    for (const member of members) {
      evidenceByUser.set(member.user_id, { liked: [], disliked: [] });
    }
    for (const swipe of relevantSwipes) {
      const bucket = evidenceByUser.get(swipe.user_id);
      if (!bucket) continue;
      const label = swipe.card_name;
      if (swipe.direction === "like") bucket.liked.push(label);
      else if (swipe.direction === "skip") bucket.disliked.push(label);
    }
    for (const bucket of evidenceByUser.values()) {
      bucket.liked = [...new Set(bucket.liked)].slice(0, EVIDENCE_CAP);
      bucket.disliked = [...new Set(bucket.disliked)].slice(0, EVIDENCE_CAP);
    }

    // Deterministic tallies: a flash model cannot count reliably, and the
    // consensus signal is worth more than anything it could infer from prose.
    const likesByCardName = new Map<string, string[]>();
    const skipsByCardName = new Map<string, string[]>();
    for (const swipe of includedSwipes) {
      const target = swipe.direction === "like" ? likesByCardName : skipsByCardName;
      const list = target.get(swipe.card_name) || [];
      list.push(usernameById.get(swipe.user_id) || "Member");
      target.set(swipe.card_name, list);
    }

    const cardTally = cards
      .map((card) => ({
        card_id: card.id,
        name: card.name,
        likes: likesByCardName.get(card.name) || [],
        skips: skipsByCardName.get(card.name) || [],
      }))
      .filter((row) => row.likes.length > 0 || row.skips.length > 0)
      .sort((a, b) => (b.likes.length - b.skips.length) - (a.likes.length - a.skips.length));

    const categoryTally = CATEGORIES.map((category) => {
      const matching = includedSwipes.filter((s) => s.category === category);
      return {
        category,
        likes: matching.filter((s) => s.direction === "like").length,
        skips: matching.filter((s) => s.direction === "skip").length,
      };
    }).filter((row) => row.likes > 0 || row.skips > 0);

    const layer1 = {
      destination: trip.destination,
      dates: [isoDay(trip.start_date), isoDay(trip.end_date)].filter(Boolean),
      members: members.length,
      trip_style: deriveTripStyle(summaries),
    };

    const layer2: Record<string, unknown> = {};
    for (const member of members) {
      const summary = summaryByUser.get(member.user_id);
      if (!summary) continue;
      layer2[member.username] = {
        style: summary.style_name,
        priorities: summary.priorities,
        interests: summary.interests,
        avoid: [
          ...summary.dislikes,
          ...summary.constraints,
          ...summary.dietary_constraints,
        ].slice(0, 10),
        pace: summary.pace,
        dining: summary.dining_preference,
        budget: summary.budget_preference,
        insights: summary.reasoning_insights.slice(0, 4),
      };
    }

    const layer3: Record<string, unknown> = {};
    for (const member of members) {
      const evidence = evidenceByUser.get(member.user_id);
      if (!evidence || (evidence.liked.length === 0 && evidence.disliked.length === 0)) continue;
      layer3[member.username] = evidence;
    }

    // ---- Gemini call A: Group Planner Agent ------------------------------
    const plannerSystem = `You are the Group Planner Agent for a group travel planning application.

You receive three layers of information:
- Layer 1: trip-level constraints (destination, dates, member count, trip style).
- Layer 2: each member's preference summary (priorities, interests, avoid, pace, dining, budget, insights).
- Layer 3: relevant swipe evidence -- only the deck cards each member actually liked or disliked.
- Precomputed tallies: exact per-place like/skip counts and per-category like/skip counts. Trust these numbers over your own reading; never recount.

Your job is consensus, not a schedule. Decide WHAT the group should do and where the genuine friction is.

Return exactly one JSON object:
{
  "group_priorities": string[],
  "group_conflicts": [
    { "topic": string, "members_a": string[], "members_b": string[], "resolution": string }
  ],
  "hard_constraints": string[],
  "recommended_balance": {
    "food": "high" | "medium" | "low",
    "culture": "high" | "medium" | "low",
    "nature": "high" | "medium" | "low",
    "shopping": "high" | "medium" | "low",
    "nightlife": "high" | "medium" | "low",
    "wellness": "high" | "medium" | "low"
  }
}

Rules:
- group_priorities: 3-6 ranked themes that most of the group shares, grounded in the summaries and tallies.
- group_conflicts: only genuine splits. A place liked by some and skipped by others is a conflict; opposite paces or dietary limits can also be conflicts. Name members by their exact display name from Layer 2/3. resolution must be a concrete compromise, not a platitude.
- hard_constraints: at most 6 genuine limits (dietary needs, mobility, budget, strong exclusions, maximum activities per day if the evidence supports one). Phrase a cap as "maximum N activities per day" when applicable.
- recommended_balance: the group's overall weighting across the six categories.
- If the group agrees, return an empty conflicts array. Do not invent conflict.
- Never propose places, days, times, or an itinerary. That is the Itinerary Agent's job.
- Return valid JSON only. No markdown. No explanation outside the JSON object.`;

    const plannerPrompt = `Layer 1 -- group-level constraints:
${JSON.stringify(layer1, null, 2)}

Layer 2 -- preference summaries:
${JSON.stringify(layer2, null, 2)}

Layer 3 -- relevant swipe evidence:
${JSON.stringify(layer3, null, 2)}

Per-place like/skip tallies (exact):
${JSON.stringify(cardTally.slice(0, 20))}

Per-category tallies (exact):
${JSON.stringify(categoryTally)}

Produce the group profile JSON now.`;

    const plannerRaw = await callGemini(GEMINI_API_KEY, plannerSystem, plannerPrompt, 2048);

    let plannerParsed: Record<string, unknown>;
    try {
      plannerParsed = JSON.parse(stripJsonFence(plannerRaw));
    } catch {
      return await fail("Group Planner returned invalid JSON.");
    }

    const groupProfile: GroupProfile = {
      group_priorities: toStringArray(plannerParsed.group_priorities, 6),
      group_conflicts: Array.isArray(plannerParsed.group_conflicts)
        ? (plannerParsed.group_conflicts as Record<string, unknown>[])
          .map((c) => ({
            topic: typeof c.topic === "string" ? c.topic.trim() : "",
            members_a: toStringArray(c.members_a, 8),
            members_b: toStringArray(c.members_b, 8),
            resolution: typeof c.resolution === "string" ? c.resolution.trim() : "",
          }))
          .filter((c) => c.topic.length > 0)
          .slice(0, 5)
        : [],
      hard_constraints: toStringArray(plannerParsed.hard_constraints, 6),
      recommended_balance: (() => {
        const raw = (plannerParsed.recommended_balance || {}) as Record<string, unknown>;
        const out: Record<string, string> = {};
        for (const category of CATEGORIES) {
          const value = raw[category];
          out[category] = value === "high" || value === "low" ? value : "medium";
        }
        return out;
      })(),
      trip_style: layer1.trip_style,
    };

    // ---- Gemini call B: Itinerary Agent ----------------------------------
    const dayCount = trip.start_date && trip.end_date
      ? Math.max(
        1,
        Math.round(
          (new Date(trip.end_date).getTime() - new Date(trip.start_date).getTime()) / 86400000,
        ) + 1,
      )
      : 1;

    const dayDates = Array.from({ length: dayCount }, (_, i) => {
      if (!trip.start_date) return null;
      const d = new Date(trip.start_date);
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });

    const candidateCards = cards
      .filter((c) => typeof c.latitude === "number" && typeof c.longitude === "number")
      .map((c) => ({
        card_id: c.id,
        name: c.name,
        category: categoryOf(c),
        area: c.address_or_area || "",
        duration_min: c.estimated_duration_min ?? null,
        rating: c.rating ?? null,
        description: (c.description || "").slice(0, 140),
      }));

    if (candidateCards.length === 0) {
      return await fail("None of this trip's deck cards have coordinates, so no route can be built.");
    }

    const itinerarySystem = `You are the Itinerary Agent for a group travel planning application.

You receive a group profile (priorities, conflicts, hard constraints, recommended balance) and a list of candidate places drawn from the group's own swipe deck. You decide which places the group visits and on which day.

You do NOT decide times, arrival order, travel durations, or distances. Routing is computed by a separate engine from real map data after you answer.

Return exactly one JSON object:
{
  "days": [
    {
      "day_index": 0,
      "title": string,
      "transport_mode": "walking" | "driving",
      "stops": [ { "card_id": string, "why": string } ]
    }
  ]
}

Rules:
- Use ONLY card_id values from the candidate list. Never invent a place or id.
- Return exactly one day object per requested day_index, starting at 0.
- ${MIN_STOPS_PER_DAY}-${MAX_STOPS_PER_DAY} stops per day. Respect any "maximum N activities per day" constraint in hard_constraints.
- Balance categories across each day according to recommended_balance; when a member is conflicted about a place, include it only if the resolution supports it.
- Include one food stop around midday on each day when a suitable candidate exists.
- Group candidates in the same area into the same day to minimise travel.
- transport_mode: "walking" when the day's candidates are close together, "driving" when they are spread out or the day includes a far exurb.
- "title" is a short human name for the day (3-6 words), e.g. "Petronas Twin Towers & KLCC".
- "why" is one short sentence tying the stop to the group profile (a priority or a conflict resolution). No times, no distances.
- Return valid JSON only. No markdown. No explanation outside the JSON object.`;

    const itineraryPrompt = `Group profile:
${JSON.stringify(groupProfile, null, 2)}

Trip length: ${dayCount} day${dayCount === 1 ? "" : "s"}
Day indices requested: ${Array.from({ length: dayCount }, (_, i) => i).join(", ")}

Candidate places (use these card_id values only):
${JSON.stringify(candidateCards, null, 2)}

Select activities and assign them to days. Return the JSON object now.`;

    const itineraryRaw = await callGemini(GEMINI_API_KEY, itinerarySystem, itineraryPrompt, 4096);

    let itineraryParsed: Record<string, unknown>;
    try {
      itineraryParsed = JSON.parse(stripJsonFence(itineraryRaw));
    } catch {
      return await fail("Itinerary Agent returned invalid JSON.");
    }

    const rawDays = Array.isArray(itineraryParsed.days)
      ? (itineraryParsed.days as Record<string, unknown>[])
      : [];

    // ---- Validate and fill ----------------------------------------------
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const usedCardIds = new Set<string>();
    const perDayCap = maxStopsPerDay(groupProfile);

    const toStop = (cardId: string, why: string): PlanStop | null => {
      const card = cardById.get(cardId);
      if (!card) return null;
      return {
        card_id: card.id,
        name: card.name,
        category: categoryOf(card),
        area: card.address_or_area || "",
        description: card.description || "",
        img: photoUrl(SUPABASE_URL, card),
        lat: card.latitude,
        lng: card.longitude,
        estimated_duration_min: card.estimated_duration_min,
        rating: card.rating,
        why: why.slice(0, 240),
      };
    };

    const days: PlanDay[] = Array.from({ length: dayCount }, (_, dayIndex) => {
      const raw = rawDays.find((d) => Number(d.day_index) === dayIndex) || {};
      const rawStops = Array.isArray(raw.stops) ? (raw.stops as Record<string, unknown>[]) : [];

      const stops: PlanStop[] = [];
      for (const rawStop of rawStops) {
        if (stops.length >= perDayCap) break;
        const cardId = typeof rawStop.card_id === "string" ? rawStop.card_id : "";
        if (!cardId || usedCardIds.has(cardId)) continue;
        const stop = toStop(cardId, typeof rawStop.why === "string" ? rawStop.why.trim() : "");
        if (!stop) continue;
        usedCardIds.add(cardId);
        stops.push(stop);
      }

      const transportMode = raw.transport_mode === "driving" ? "driving" : "walking";
      const fallbackTitle = stops[0]?.name || `Day ${dayIndex + 1}`;

      return {
        day_index: dayIndex,
        date: dayDates[dayIndex],
        title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : fallbackTitle,
        transport_mode: transportMode,
        stops,
      };
    });

    // Deterministic top-up: any day the agent under-filled gets unused cards,
    // best-rated first, so a thin model answer does not produce an empty day.
    const affinityOf = (card: CardRow) => {
      const likes = (likesByCardName.get(card.name) || []).length;
      const skips = (skipsByCardName.get(card.name) || []).length;
      return (likes - skips) * 10 + (card.rating ?? 0);
    };
    const unusedPool = cards
      .filter((c) => !usedCardIds.has(c.id) && typeof c.latitude === "number" && typeof c.longitude === "number")
      .sort((a, b) => affinityOf(b) - affinityOf(a));

    for (const day of days) {
      while (day.stops.length < MIN_STOPS_PER_DAY && unusedPool.length > 0 && day.stops.length < perDayCap) {
        const card = unusedPool.shift()!;
        usedCardIds.add(card.id);
        const stop = toStop(card.id, "Fills out the day with a strong group-rated option.");
        if (stop) day.stops.push(stop);
      }
    }

    const unassigned = cards
      .filter((c) => !usedCardIds.has(c.id))
      .map((c) => toStop(c.id, ""));
    const unassignedStops = unassigned.filter((s): s is PlanStop => s !== null);

    const candidatePois = { days, unassigned: unassignedStops };

    // The reveal card's numbers, and the counts underneath "Why this plan?".
    // Both are snapshots of what the analysis actually covered.
    const stats = {
      travellers: members.length,
      preferences: includedSwipes.length,
      shared: groupProfile.group_priorities.length,
    };

    const rationale = buildRationale({
      summaries: members.map((m) => summaryByUser.get(m.user_id)!).filter(Boolean),
      memberCount: members.length,
      cardTally,
      groupProfile,
      days,
    });

    await admin.updatePlan(tripId, {
      status: "ready",
      error_message: null,
      group_profile: groupProfile,
      candidate_pois: candidatePois,
      validated_plan: null,
      generated_by: userId,
      included_members: members.map((m) => m.user_id),
      stats,
      rationale,
      rebuilds: {},
      confirmed_at: null,
      confirmed_by: null,
    });

    console.log(
      `[group-planner] Ready for trip ${tripId}: ${days.length} day(s), ` +
        `${days.reduce((n, d) => n + d.stops.length, 0)} stops, ${unassignedStops.length} unassigned.`,
    );

    return json({
      tripId,
      status: "ready",
      generated: true,
      groupProfile,
      days: days.length,
    });
  } catch (err) {
    console.error("[group-planner] unexpected error:", err);
    try {
      await admin.updatePlan(tripId, {
        status: "failed",
        error_message: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      });
    } catch {
      // The row may not exist; nothing more to do.
    }
    return json(
      { tripId, status: "failed", error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
