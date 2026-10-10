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

const PHOTO_BUCKET = "trip-photos";

/**
 * Every way a deck can fail, as a code the client can branch on.
 *
 * This exists because the alternative was the UI inferring the cause from
 * `error_message`, and it inferred wrong in the worst possible direction: a deck
 * that returned no cards was reported to the traveller as "limited photo-
 * verified places found for {destination}", blaming Johor when the real cause
 * was a stale deploy writing cards under a key the client never read. The
 * message was confidently wrong, which is worse than saying nothing.
 *
 * A code here means the server *knows* what went wrong and is stating it. The
 * absence of a code means there is no failure to explain. The client is required
 * to render the unknown as unknown rather than falling back to a guess.
 */
const DECK_FAILURE = {
  /** The place search ran and nothing it found had a usable photo. */
  NO_PHOTO_RESULTS: "no_photo_results",
  /** The model named no usable locations for this destination. */
  NO_LOCATIONS: "no_locations",
  /** Places were found but the database rejected the rows. Our fault. */
  STORAGE_FAULT: "storage_fault",
  /** Gemini or SerpApi was unreachable or refusing us. Not the destination's. */
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  /** Could not claim the deck row, so generation never started. */
  CLAIM_FAILED: "claim_failed",
  /**
   * The client asked for one deck key and this function computed another.
   *
   * Purely our bug, and the one worth naming precisely: the two sides of the
   * cache key are duplicated implementations that nothing compares. When they
   * drift the generator writes a full, healthy deck that the client is not
   * watching — a silent failure with a 200 on both ends and no way to tell it
   * apart from a thin destination. The client already sends the key it intends
   * to read, so this is detectable exactly where it happens.
   */
  DECK_KEY_MISMATCH: "deck_key_mismatch",
  /** Escaped an exception we have no classification for. */
  UNKNOWN: "unknown",
} as const;

type DeckFailureCode = (typeof DECK_FAILURE)[keyof typeof DECK_FAILURE];

/**
 * How many swipe cards a trip of a given length should produce.
 *
 * The deck is sized from trip length because a swiper's effort should scale
 * with the trip they are planning: one day is a short list, a week is a real
 * decision. Before this the count came from the model's own guess at how big
 * the destination is, which meant a 2-day and a 12-day trip to the same city
 * got the same deck.
 *
 * Mirrored in src/lib/cardTargets.js. The deploy bundles this directory alone,
 * so it cannot import from `src/`; the two must agree byte for byte and
 * src/lib/cardTargets.test.js fails when they drift.
 */
const CARD_TARGETS: Record<number, number> = { 1: 4, 2: 7, 3: 10, 4: 15, 5: 19, 6: 25 };

/** Past the literal table the count grows linearly, four cards per extra day. */
const LONG_TRIP_ANCHOR_DAYS = 6;
const LONG_TRIP_SLOPE = 4;

/**
 * The model keeps its judgement: it is told the target and may return more or
 * fewer depending on what the destination actually offers. This ceiling only
 * stops a generous model returning something we would spend minutes enriching.
 */
const CARD_CAP_MULTIPLIER = 1.5;

/**
 * Days a trip lasts when no dates were captured. Dates are optional, so the
 * client skips generation entirely without them and shows the fallback deck; this
 * covers legacy trips saved before dates were captured, where a sensible size
 * beats refusing to generate.
 */
const DEFAULT_TRIP_DAYS = 3;

/**
 * Coerces anything the request might hold to a day count.
 *
 * Absence and nonsense both fall back to the default rather than to 1 day:
 * `Number(null)` and `Number("")` are both 0, which would otherwise read as a
 * deliberate one-day trip and quietly shrink the deck to four cards.
 */
function normaliseDays(days: unknown): number {
  if (days == null || days === "") return DEFAULT_TRIP_DAYS;
  const n = Number(days);
  if (!Number.isFinite(n)) return DEFAULT_TRIP_DAYS;
  return Math.max(1, Math.round(n));
}

/**
 * Target card count for a trip length.
 *
 * One to six days read straight from the table, which is not linear (the steps
 * are +3, +3, +5, +4, +6) because each row was chosen by hand. Beyond six the
 * table gives out and the count continues at a flat four per day.
 */
function cardTargetForDays(days: unknown): number {
  const d = normaliseDays(days);
  if (d <= LONG_TRIP_ANCHOR_DAYS) return CARD_TARGETS[d];
  return CARD_TARGETS[LONG_TRIP_ANCHOR_DAYS] + LONG_TRIP_SLOPE * (d - LONG_TRIP_ANCHOR_DAYS);
}

/** Hard ceiling on how many cards a trip of this length may produce. */
function cardCapForDays(days: unknown): number {
  return Math.round(cardTargetForDays(days) * CARD_CAP_MULTIPLIER);
}

interface LocationSuggestion {
  name: string;
  category: string;
  estimatedDuration: number | null;
}

interface EnrichedPlace {
  title: string;
  lat: number;
  lng: number;
  placeId: string;
  thumbnail: string;
  rating: number | null;
  reviewCount: number | null;
  address: string;
}

// SerpApi's google_maps engine takes 2-6s per search, so running the enrichment
// sequentially costs ~4s x locations. A small pool overlaps those waits; the
// cap keeps us under SerpApi's searches-per-second limit instead of trading
// latency for 429s.
const SERP_CONCURRENCY = 4;
const SERP_TIMEOUT_MS = 12_000;
const SERP_429_BACKOFF_MS = 1_500;

/**
 * Wall clock ceiling for this worker. Supabase terminates an Edge Function at
 * 150s on the free plan and 400s on paid, and a worker killed mid-run skips the
 * terminal `status: ready` write — which strands the deck as "generating" for
 * everyone watching it, not just this caller.
 *
 * Enrichment is budgeted from whatever is left of this rather than from a fixed
 * 25s. A 25s cap was sized for a 19-card deck; a 6-day trip asks for 25 and a
 * fortnight asks for 57, and at ~1 card/second (four concurrent searches, 2-6s
 * each) anything past roughly five days silently lost cards to the deadline.
 */
const WALL_CLOCK_BUDGET_MS = Number(Deno.env.get("GENERATE_TRIP_WALL_CLOCK_MS") || 150_000);

/** Held back for the terminal deck write, the photo upgrades and the response. */
const WALL_CLOCK_MARGIN_MS = 10_000;

/**
 * What is left of the wall clock budget once the LLM call has been paid for.
 * The floor keeps a slow-arriving request from leaving no budget at all, which
 * would drop every location and fail the deck outright.
 */
function enrichmentBudgetMs(requestStartedAt: number): number {
  const elapsed = Date.now() - requestStartedAt;
  return Math.max(5_000, WALL_CLOCK_BUDGET_MS - WALL_CLOCK_MARGIN_MS - elapsed);
}

// Gemini has no client-imposed deadline of its own, so a hung request would
// otherwise hold the claim open indefinitely.
// A real generation is a much bigger job than a probe, so the ceiling is
// generous: a slow-but-working model must not be killed mid-answer. The
// flash-latest alias was observed hanging past 25s on a trivial request, which
// is exactly why it is a late fallback rather than a first choice.
const GEMINI_TIMEOUT_MS = 45_000;

// A 404 here means the model is not served to this key at all, so retrying is
// pointless and the loop should move on immediately. A 503 is capacity
// pressure and resolves on its own, so it gets a bounded number of tries.
// Kept small because the list now leads with verified-working models: the
// fallbacks should not cost more time than they save.
const GEMINI_TRANSIENT_ATTEMPTS = 3;
const GEMINI_PER_MODEL_ATTEMPTS = 2;

// Order is set by a live probe of this project's key, not by guesswork.
//
// Probed 2026-09-30 against this account (via the model-probe function):
//   gemini-flash-lite-latest 200, ~0.9s  — works, fastest
//   gemini-3.8-flash         200, ~9.5s  — works
//   gemini-3.6-flash         200, ~10s   — works
//   gemini-flash-latest      200, ~9.6s  — works
//   gemini-3.5-flash         429 out of quota for this key
//   gemini-3.1-pro-preview   429 out of quota for this key
//
// Quota is per-model here, not account-wide: the same probe that gets a 429
// from gemini-3.5-flash gets a 200 from gemini-flash-lite-latest in under a
// second. So a model that is out of quota is skipped, never treated as a dead
// account. gemini-flash-lite-latest leads because it is both the fastest and
// the one least likely to be throttled.
const GEMINI_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash",
];

/**
 * Runs `worker` over `items` with at most `limit` in flight. Preserves input
 * order in the returned array, and a worker that throws yields null rather
 * than rejecting the batch.
 */
async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        console.warn(`[generate-trip] Pool worker failed on item ${index}:`, err);
        results[index] = null as R;
      }
    }
  });

  await Promise.all(runners);
  return results;
}

/** JSON body with CORS. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/**
 * Distinguishes an exhausted per-model quota from ordinary per-minute rate
 * limiting.
 *
 * Both arrive as 429, but only one clears within a request. Google's
 * quota-exhausted message names billing explicitly, whereas a per-minute limit
 * says "rate limit" or "resets at".
 *
 * This is deliberately scoped to ONE model rather than the whole account: a
 * probe of this key shows gemini-3.5-flash returning a billing-quota 429 while
 * gemini-flash-lite-latest answers in under a second. Treating that as a dead
 * account aborted the entire run and threw away a working model list.
 */
function isQuotaExhausted(status: number, body: string): boolean {
  if (status !== 429) return false;
  const text = body.toLowerCase();
  // "quota" on its own is ambiguous: per-minute limits are also expressed as a
  // quota ("quota of 10 requests per minute exceeded") and do clear on their
  // own, so a bare mention must not trigger the fast path.
  if (text.includes("billing") || text.includes("exceeded your current quota")) {
    return true;
  }
  // A per-minute limit is recoverable; anything else that is merely described
  // as a quota is treated the same way and left to the retry loop.
  const recoverable =
    text.includes("rate limit") ||
    text.includes("rate-limit") ||
    text.includes("resets at") ||
    text.includes("per minute") ||
    text.includes("per 100 seconds");
  return !recoverable && text.includes("quota");
}

/**
 * Derives the same cache key the client builds in tripService.buildDeckId.
 * Both sides must agree, so it is recomputed here rather than trusted from the
 * request body — a mismatched key would silently create a second cache entry.
 *
 * Trip length is part of the key, not a detail of the prompt. Without it a
 * one-day and a six-day trip to the same destination with the same preferences
 * shared one deck, and whoever arrived second was handed the first person's
 * card count regardless of how long they were staying.
 */
function buildDeckId(
  destination: string,
  preferences: Record<string, unknown>,
  days: number
): string {
  const dest = destination.trim().toLowerCase().replace(/\s+/g, " ");
  const prefs = preferences || {};
  const parts = Object.keys(prefs)
    .sort()
    .map((key) => {
      const value = preferences[key];
      if (value == null) return "";
      if (Array.isArray(value)) return `${key}=${value.join(",")}`;
      return `${key}=${String(value)}`;
    })
    .filter(Boolean);
  return `${dest}::${[...parts, `days=${days}`].join("|")}`;
}

/** Minimal PostgREST client bound to the service role, which bypasses RLS. */
function adminClient(supabaseUrl: string, serviceRoleKey: string) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  return {
    headers,
    async insertCard(deckId: string, position: number, loc: LocationSuggestion, place: EnrichedPlace) {
      const res = await fetch(`${supabaseUrl}/rest/v1/trip_cards`, {
        method: "POST",
        // Without this PostgREST answers a bare 201 with an empty body, so
        // `res.json()` below threw on every *successful* insert and the row
        // came back null — the card was written but never counted.
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({
          deck_id: deckId,
          position,
          name: place.title,
          category: loc.category,
          style_hint: CATEGORY_TO_STYLE[loc.category] || "balanced",
          thumbnail_url: place.thumbnail,
          latitude: place.lat,
          longitude: place.lng,
          place_id: place.placeId,
          rating: place.rating,
          review_count: place.reviewCount,
          address_or_area: place.address,
          estimated_duration_min: loc.estimatedDuration,
        }),
      });
      if (!res.ok) {
        console.warn(`[generate-trip] Card insert failed: ${res.status} ${await res.text().catch(() => "")}`);
        return null;
      }
      return (await res.json())?.[0] ?? null;
    },
    async clearDeckCards(deckId: string) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/trip_cards?deck_id=eq.${encodeURIComponent(deckId)}`,
        { method: "DELETE", headers }
      );
      if (!res.ok) {
        console.warn(`[generate-trip] Card clear failed: ${res.status} ${await res.text().catch(() => "")}`);
      }
      return res.ok;
    },
    async linkTripToDeck(tripId: string, deckId: string) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/trip_deck_links?on_conflict=trip_id`,
        {
          method: "POST",
          // `on_conflict` in the query string is inert on its own: PostgREST only
          // treats the POST as an upsert when this header says so, so without it
          // the request degrades to a plain INSERT and every relink of an
          // already-linked trip fails 409 on the trip_deck_links primary key. A
          // trip would then stay pinned to the first deck it ever generated,
          // even after the traveller changed destination, dates or preferences.
          headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ trip_id: tripId, deck_id: deckId }),
        }
      );
      if (!res.ok) {
        // Not fatal: the deck still generates and streams, and a later call
        // will retry the link.
        console.warn(`[generate-trip] Trip link failed: ${res.status} ${await res.text().catch(() => "")}`);
      }
    },
    async updateDeck(deckId: string, patch: Record<string, unknown>) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/curated_decks?id=eq.${encodeURIComponent(deckId)}`,
        { method: "PATCH", headers, body: JSON.stringify(patch) }
      );
      if (!res.ok) {
        console.warn(`[generate-trip] Deck update failed: ${res.status} ${await res.text().catch(() => "")}`);
      }
      return res.ok;
    },
    async markDeckFailed(deckId: string, code: DeckFailureCode, message: string) {
      await fetch(`${supabaseUrl}/rest/v1/curated_decks?id=eq.${encodeURIComponent(deckId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "failed", error_code: code, error_message: message.slice(0, 500) }),
      });
    },
    async setCardImage(cardId: string, storagePath: string) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/trip_cards?id=eq.${cardId}`,
        { method: "PATCH", headers, body: JSON.stringify({ img_storage_path: storagePath }) }
      );
      if (!res.ok) {
        console.warn(`[generate-trip] Card image update failed: ${res.status}`);
      }
    },
    async uploadPhoto(path: string, bytes: ArrayBuffer, contentType: string) {
      const res = await fetch(`${supabaseUrl}/storage/v1/object/${PHOTO_BUCKET}/${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, "x-upsert": "true" },
        body: bytes,
      });
      if (!res.ok) {
        console.warn(`[generate-trip] Photo upload failed: ${res.status} ${await res.text().catch(() => "")}`);
        return false;
      }
      return true;
    },
  };
}

/**
 * Copies a hotlinked thumbnail into our own bucket and returns the stored path.
 *
 * Runs after the card row is committed, so a failure here degrades to "still
 * hotlinked" rather than losing the card. The remote URL is the fragile part:
 * it can 404 later, and a card whose image fails used to be dropped entirely.
 */
async function upgradePhoto(
  admin: ReturnType<typeof adminClient>,
  cardId: string,
  hotlink: string,
): Promise<void> {
  try {
    const res = await fetch(hotlink, {
      // Google's thumbnails reject requests that look like a hotlink.
      headers: { "User-Agent": "Mozilla/5.0 jet2holiday" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return;

    const bytes = await res.arrayBuffer();
    // SerpApi thumbnails are small; anything larger is not the image we asked
    // for and would just burn storage.
    if (bytes.byteLength === 0 || bytes.byteLength > 5_000_000) return;

    // Unguessable path: the bucket is public, so the filename carries the
    // entropy rather than the bucket ACL.
    const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const path = `decks/${cardId}/${rand}.${contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg"}`;

    if (await admin.uploadPhoto(path, bytes, contentType)) {
      await admin.setCardImage(cardId, path);
    }
  } catch (err) {
    console.warn(`[generate-trip] Photo upgrade failed for card ${cardId}:`, err);
  }
}

/**
 * Resolves an RLS-bypassing key for the admin client.
 *
 * Prefers the new `sb_secret_` keys, falling back to the legacy service_role
 * JWT. Both are injected into every function's environment by the platform --
 * the name is `SUPABASE_SERVICE_ROLE_KEY`, not `SERVICE_ROLE_KEY`, and reading
 * the wrong one silently disables every card insert.
 */
function resolveSecretKey(): string | null {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (parsed?.default) return parsed.default;
    } catch {
      // Malformed JSON here falls through to the legacy key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Captured per request, not at module scope: a Deno isolate serves more than
  // one request, so a module-level start time would charge every later request
  // for the first one's wall clock.
  const requestStartedAt = Date.now();

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  const SERP_API_KEY = Deno.env.get("SERP_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  // Needed to insert card rows: the anon key cannot write under RLS, and the
  // JWT below is already verified before we touch the database.
  const SECRET_KEY = resolveSecretKey();

  if (!GEMINI_API_KEY || !SERP_API_KEY) {
    return json({ error: "GEMINI_API_KEY or SERP_API_KEY not configured" }, 500);
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json({ error: "Supabase credentials not configured" }, 500);
  }
  if (!SECRET_KEY) {
    return json({ error: "No service-role key available for card writes" }, 500);
  }

  // Q34: verify JWT server-side, derive userId from token — body userId ignored.
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

  let body: {
    destination?: string;
    startDate?: string | null;
    endDate?: string | null;
    preferences?: Record<string, unknown>;
    deckId?: string;
    tripId?: string;
    // Regenerate: ignore a ready deck and re-claim this cache key, in place.
    force?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const destination = (body.destination || "").trim();
  if (!destination) return json({ error: "destination is required" }, 400);

  // Trip length in inclusive days: 5 Oct to 9 Oct is five days, not four.
  //
  // This used to measure the gap between the dates, which is the number of
  // *nights*, so a 5-day trip announced "Trip length: 4 days" here while the
  // itinerary and the hub badge both called it five. Anything sizing a deck from
  // the length would have been off by one against what the traveller sees.
  const tripDays = normaliseDays(
    body.startDate && body.endDate
      ? Math.round((new Date(body.endDate!).getTime() - new Date(body.startDate!).getTime()) / 86_400_000) + 1
      : null
  );
  const targetCardCount = cardTargetForDays(tripDays);
  const capCardCount = cardCapForDays(tripDays);

  const preferences = body.preferences || {};
  const deckId = buildDeckId(destination, preferences, tripDays);
  const admin = adminClient(SUPABASE_URL, SECRET_KEY);

  // Only the claim's own user may generate. A second request for the same deck
  // is answered from the table instead of duplicating the work.
  //
  // The response is read as a plain array. Destructuring `data` here reads a
  // property off a Response object, which has none — so `existing` was always
  // undefined, every repeat request fell through to the insert, hit a 409 on a
  // deck that already existed, and returned "pending" without generating.
  // Once a deck row existed it could never be regenerated, force or not.
  const deckRows = await fetch(
    `${SUPABASE_URL}/rest/v1/curated_decks?id=eq.${encodeURIComponent(deckId)}&select=*`,
    { headers: admin.headers }
  )
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);

  const existing = Array.isArray(deckRows) ? deckRows[0] : undefined;

  if (existing?.status === "ready" && !body.force) {
    // Cache hit. Link the trip if it is not already on this deck, then let the
    // client read the rows: no LLM, no SerpApi, no generation.
    if (body.tripId) await admin.linkTripToDeck(body.tripId, deckId);
    return json({ deckId, isGenerator: false, status: "ready", generated: false });
  }

  if (
    existing &&
    existing.status === "pending" &&
    existing.claimed_by !== userId &&
    !body.force
  ) {
    // Somebody else is mid-generation; the client watches Realtime for rows.
    if (body.tripId) await admin.linkTripToDeck(body.tripId, deckId);
    return json({ deckId, isGenerator: false, status: "pending", generated: false });
  }

  // The client tells us which deck key it is about to read. It is not trusted
  // for anything -- the key is recomputed above -- but comparing the two is the
  // only place the drift between the two implementations becomes visible. When
  // they disagree, generation writes a healthy deck nobody is watching, and the
  // client sees an empty result it cannot explain. That is the exact shape of
  // the failure that shipped as "limited photo-verified places found for
  // Johor" while twelve cards sat in the table under a different key.
  const clientDeckId = typeof body.deckId === "string" ? body.deckId.trim() : "";
  if (clientDeckId && clientDeckId !== deckId) {
    console.error(
      `[generate-trip] DECK KEY MISMATCH for "${destination}" — ` +
        `client will read "${clientDeckId}" but this function writes "${deckId}". ` +
        `The two buildDeckId implementations have drifted; the client will find no cards.`
    );
  }

  const claimedAt = new Date().toISOString();
  if (!existing) {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/curated_decks`, {
      method: "POST",
      headers: { ...admin.headers, Prefer: "return=representation" },
      body: JSON.stringify({
        id: deckId,
        destination,
        preferences_text: Object.keys(preferences).sort().map((k) => {
          const v = preferences[k];
          if (v == null) return "";
          return `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`;
        }).filter(Boolean).join("|"),
        status: "pending",
        claimed_by: userId,
        claimed_at: claimedAt,
      }),
    });

    // Someone won the race between our read and this insert. Let them finish,
    // but still point this trip at their deck.
    if (!insertRes.ok && insertRes.status === 409) {
      if (body.tripId) await admin.linkTripToDeck(body.tripId, deckId);
      return json({ deckId, isGenerator: false, status: "pending", generated: false });
    }

    if (!insertRes.ok) {
      return json(
        {
          deckId,
          isGenerator: false,
          status: "failed",
          error_code: DECK_FAILURE.CLAIM_FAILED,
          error: `Deck claim failed (${insertRes.status})`,
        },
        200
      );
    }
  } else {
    await admin.updateDeck(deckId, {
      status: "pending",
      claimed_by: userId,
      claimed_at: claimedAt,
      error_message: null,
    });
  }

  // Link only once the deck row exists. The other order is what produced a
  // foreign-key violation: trip_deck_links.deck_id references a row that has
  // not been created yet.
  if (body.tripId) await admin.linkTripToDeck(body.tripId, deckId);

  // Cards from an earlier run stay in place until this run has produced
  // replacements: trip_cards is UNIQUE (deck_id, position), so they have to go
  // before the first insert, but clearing them up front meant a failure part
  // way through left a shared deck with zero cards. The clear happens in
  // clearStaleCards() immediately before the first insert.
  let clearedStaleCards = false;
  const clearStaleCards = async () => {
    if (!existing || clearedStaleCards) return;
    await admin.clearDeckCards(deckId);
    clearedStaleCards = true;
  };

  const fail = async (code: DeckFailureCode, message: string) => {
    console.error(`[generate-trip] FAILED (${code}) for "${destination}": ${message}`);
    await admin.markDeckFailed(deckId, code, message);
    return json({ deckId, isGenerator: true, status: "failed", error_code: code, error: message }, 200);
  };

  try {
    const prefLines = [
      preferences.rhythm ? `Travel rhythm: ${preferences.rhythm}` : "",
      preferences.density ? `Itinerary density: ${preferences.density}` : "",
      preferences.dining ? `Dining style: ${preferences.dining}` : "",
      preferences.foodBudget ? `Food budget: ${preferences.foodBudget}` : "",
      Array.isArray(preferences.dietary) && preferences.dietary.length
        ? `Dietary needs: ${preferences.dietary.join(", ")}`
        : "",
      Array.isArray(preferences.requirements) && preferences.requirements.length
        ? `Access and practical requirements: ${preferences.requirements.join(", ")}`
        : "",
      preferences.note ? `Extra note: ${preferences.note}` : "",
    ].filter(Boolean).join("\n");

    const systemInstruction = `You are the jet2holiday Itinerary Agent. Your ONLY job: given a travel destination and a trip length, return a JSON array of the best places to visit there.
Output format: [{"name":"Place name","category":"one of: ${CATEGORIES.join(", ")}","estimated_duration_min":90}]
Rules:
- Aim for ${targetCardCount} locations: that is roughly ${targetCardCount} candidate places for each of ${tripDays} day${tripDays === 1 ? "" : "s"}, and it is what the traveller expects to choose between. Never return more than ${capCardCount}.
- Use the destination to decide where within that to land, not to override it. A small town with genuinely little to offer may come in a little under the target; a big city may run a little over. Padding out a thin destination with filler is worse than returning fewer, real places.
- Each category MUST be exactly one of: ${CATEGORIES.join(", ")}.
- Prefer area-level, well-known, real places (landmarks, neighborhoods, markets, viewpoints) over obscure or hyper-specific spots.
- Set \`estimated_duration_min\` to your best estimate of how long a typical visitor spends at the place, as a plain integer number of minutes. Use your knowledge: a quick viewpoint or market stall is 20–30, a neighbourhood or park is 60–90, a major museum or theme park is 120–180. Never omit it or set it to null.
- No prose, no markdown, no code fences — just the raw JSON array.`;

    const userPrompt = `Destination: ${destination}
Trip length: ${tripDays} day${tripDays === 1 ? "" : "s"}
${prefLines ? `Traveller preferences:\n${prefLines}` : ""}

Return the JSON array of locations now:`;

    const modelErrors: string[] = [];
    // One line per model, recording how it finally failed. Truncating to the
    // last few raw errors hid the fact that the first three models were the
    // ones actually failing, which is the part worth knowing.
    const perModel: string[] = [];
    let rawText = "";

    for (const model of GEMINI_MODELS) {
      let lastStatus = "no attempt";
      for (let attempt = 1; attempt <= GEMINI_TRANSIENT_ATTEMPTS; attempt++) {
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // Without this a hung request holds the claim open for as long
              // as the platform allows.
              signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
              body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                generationConfig: {
                  temperature: 0.4,
                  // Sized for the largest deck the table can ask for. At ~35
                  // tokens per location, 4096 held barely 19 cards — enough for
                  // the old fixed range, but a fortnight's 57 would have been
                  // cut off mid-array.
                  maxOutputTokens: 8192,
                  responseMimeType: "application/json",
                },
              }),
            }
          );

          if (!geminiRes.ok) {
            const errBody = await geminiRes.text().catch(() => "");
            const msg = `[${model} attempt ${attempt}] ${geminiRes.status}: ${errBody.slice(0, 200)}`;
            modelErrors.push(msg);
            console.warn(`[generate-trip] ${msg}`);

            // A quota wall is permanent for this model but says nothing about
            // the others, so stop retrying it immediately — retrying cannot
            // clear it and it would spend the run's time budget — then let the
            // loop walk on to the next model. Only when every model has failed
            // does this become a reportable account problem.
            if (isQuotaExhausted(geminiRes.status, errBody)) {
              lastStatus = `out of quota for this key (${geminiRes.status})`;
              console.warn(`[generate-trip] Model ${model} is out of quota, moving to the next model`);
              break;
            }

            // 404 means this key cannot use this model at all, which is a
            // permanent condition for the request rather than a blip. Bail to
            // the next model rather than burning the retry budget.
            const unavailable = geminiRes.status === 404 || geminiRes.status === 403;
            if (unavailable) {
              lastStatus = `unavailable to this key (${geminiRes.status})`;
              console.warn(`[generate-trip] Model ${model} not available to this key, skipping`);
              break;
            }

            if (geminiRes.status === 503 || geminiRes.status === 429) {
              // Capacity pressure. Keep trying this model before giving up on
              // it, but bound it by the transient budget rather than falling
              // straight through to the next model.
              lastStatus = `overloaded after ${attempt} attempt(s) (${geminiRes.status})`;
              if (attempt >= GEMINI_PER_MODEL_ATTEMPTS) break;
              await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
              continue;
            }

            lastStatus = `error ${geminiRes.status}`;
            break;
          }

          const data = await geminiRes.json();

          // A response cut off at the token ceiling is a truncated JSON array,
          // not a short one. Accepting it here sends a syntactically broken
          // string to JSON.parse below, which reports "could not parse" and
          // fails the whole deck for a reason that looks like bad JSON but is
          // really "the model tried to write more than it was allowed".
          const finishReason = data?.candidates?.[0]?.finishReason;
          if (finishReason === "MAX_TOKENS") {
            lastStatus = "truncated at the token limit";
            console.warn(`[generate-trip] ${model} hit the token ceiling; trying the next model`);
            continue;
          }

          rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          if (rawText.trim().length > 0) {
            console.log(`[generate-trip] Gemini generated locations via ${model}`);
            perModel.push(`${model}: ok`);
            break;
          }
          lastStatus = "returned an empty response";
        } catch (err) {
          lastStatus = `exception after ${attempt} attempt(s): ${String(err).slice(0, 80)}`;
          modelErrors.push(`[${model} attempt ${attempt}] Exception: ${String(err)}`);
        }
      }
      if (rawText) break;
      perModel.push(`${model}: ${lastStatus}`);
      console.warn(`[generate-trip] Model ${model} exhausted retries: ${lastStatus}`);
    }

    if (!rawText) {
      // Report every model's outcome, not just the last few raw responses. The
      // summary is what tells us whether this is a bad model list (all 404) or
      // capacity (all 503) — opposite fixes.
      const allOutOfQuota = perModel.length > 0 && perModel.every((line) => line.includes("out of quota"));
      if (allOutOfQuota) {
        return await fail(
          DECK_FAILURE.PROVIDER_UNAVAILABLE,
          `Every Gemini model is out of quota for this project key ` +
            `(${perModel.join(" | ")}). Check billing and quota at ` +
            `https://ai.google.dev/gemini-api/quotas.`
        );
      }
      return await fail(
        DECK_FAILURE.PROVIDER_UNAVAILABLE,
        `Gemini unavailable across ${GEMINI_MODELS.length} models. ` +
          `Per-model: ${perModel.join(" | ")}. ` +
          `Last response: ${modelErrors[modelErrors.length - 1] ?? "none"}`
      );
    }

    // Sanitize: strip code fences, then fall back to slicing the outermost
    // array if the model wrapped the JSON in prose.
    let cleaned = rawText.replace(/^```(?:json)?|```$/g, "").trim();
    if (!cleaned.startsWith("[")) {
      const first = cleaned.indexOf("[");
      const last = cleaned.lastIndexOf("]");
      if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return await fail(
        DECK_FAILURE.NO_LOCATIONS,
        "Could not parse location list from Gemini response"
      );
    }

    const rawLocations = Array.isArray(parsed) ? parsed : (parsed as any)?.locations;
    if (!Array.isArray(rawLocations)) {
      return await fail(DECK_FAILURE.NO_LOCATIONS, "Gemini response was not a location array");
    }

    const locations: LocationSuggestion[] = rawLocations
      .map((l: any) => ({
        name: typeof l?.name === "string" ? l.name.trim() : "",
        category: CATEGORIES.includes(l?.category) ? l.category : "culture",
        estimatedDuration:
          typeof l?.estimated_duration_min === "number" &&
          Number.isFinite(l.estimated_duration_min) &&
          l.estimated_duration_min > 0
            ? Math.round(l.estimated_duration_min)
            : null,
      }))
      .filter((l: LocationSuggestion) => l.name.length > 0)
      .slice(0, capCardCount);

    if (locations.length === 0) {
      return await fail(DECK_FAILURE.NO_LOCATIONS, "Gemini returned no usable locations");
    }

    // Publish the count before enrichment starts. This is the progress signal
    // the old pipeline could not give: the client knows a deck of this size is
    // coming instead of staring at an undifferentiated skeleton.
    await admin.updateDeck(deckId, { location_count: locations.length });
    console.log(`[generate-trip] Enriching ${locations.length} locations for "${destination}"`);

    const deadline = Date.now() + enrichmentBudgetMs(requestStartedAt);

    const searchSerp = async (q: string): Promise<any | null> => {
      const params = new URLSearchParams({
        engine: "google_maps",
        q,
        type: "search",
        api_key: SERP_API_KEY,
      });

      // Never let an in-flight search outlive the enrichment deadline,
      // otherwise the last batch to start decides the real time-to-deck.
      const budget = deadline - Date.now();
      if (budget <= 0) return null;
      const timeoutMs = Math.min(SERP_TIMEOUT_MS, budget);

      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`https://serpapi.com/search.json?${params}`, {
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.status === 429 && attempt === 0) {
          console.warn(`[generate-trip] SerpApi rate limited on "${q}", backing off`);
          await new Promise((r) => setTimeout(r, SERP_429_BACKOFF_MS));
          continue;
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.warn(`[generate-trip] SerpApi error ${res.status} for "${q}":`, errText.slice(0, 200));
          return null;
        }

        return await res.json();
      }

      return null;
    };

    const enrichOne = async (loc: LocationSuggestion): Promise<EnrichedPlace | null> => {
      const queryCandidates = [`${loc.name}, ${destination}`];
      if (!loc.name.toLowerCase().includes(destination.toLowerCase())) {
        queryCandidates.push(loc.name);
      }

      for (const q of queryCandidates) {
        const data = await searchSerp(q);
        if (!data) continue;

        const results: any[] = [];
        if (data.place_results) results.push(data.place_results);
        if (Array.isArray(data.local_results)) results.push(...data.local_results);

        for (const item of results) {
          const lat = item?.gps_coordinates?.latitude;
          const lng = item?.gps_coordinates?.longitude;
          if (typeof lat !== "number" || typeof lng !== "number") continue;

          const thumbnail =
            item.thumbnail ||
            item.photos?.[0]?.thumbnail ||
            item.photos?.[0]?.image ||
            item.photos?.[0]?.photo ||
            item.images?.[0]?.thumbnail ||
            item.images?.[0]?.image ||
            item.image ||
            item.photo ||
            "";

          if (thumbnail && typeof thumbnail === "string" && thumbnail.trim().length > 0) {
            return {
              title: item.title || loc.name,
              lat,
              lng,
              placeId: item.place_id || "",
              thumbnail: thumbnail.trim(),
              rating: typeof item.rating === "number" ? item.rating : null,
              // SerpApi exposes review counts as `reviews` (integer) on
              // place_results and local_results entries.
              reviewCount: typeof item.reviews === "number" ? item.reviews : null,
              address: item.address || "",
            };
          }
        }
      }

      return null;
    };

    // Each card is committed the moment it resolves, so clients render
    // progress and a crash mid-run keeps what already landed.
    let inserted = 0;
    let photoMisses = 0;
    let insertFailures = 0;
    const photoUpgrades: Promise<void>[] = [];

    // Everything that can fail before a single row is written has now
    // succeeded, so it is safe to retire the previous run's cards.
    await clearStaleCards();

    await runPool(locations, SERP_CONCURRENCY, async (loc, index) => {
      if (Date.now() >= deadline) {
        console.log(
          `[generate-trip] Wall clock budget exhausted after ` +
            `${Date.now() - requestStartedAt}ms, skipping "${loc.name}"`
        );
        return null;
      }

      const found = await enrichOne(loc);
      if (!found) {
        photoMisses += 1;
        console.log(`[generate-trip] No photo-verified result for "${loc.name}" in "${destination}"`);
        return null;
      }

      const row = await admin.insertCard(deckId, index, loc, found);
      if (!row) {
        // A verified photo we failed to persist is a database fault, not a
        // missing photo. Counting it as the latter is what let a broken column
        // name surface as "no places could be photo-verified".
        insertFailures += 1;
        return null;
      }

      inserted += 1;
      console.log(`[generate-trip] Inserted [${inserted}/${locations.length}]: "${found.title}"`);

      // Fire-and-forget: the card is already visible via the hotlink, and the
      // storage copy is a durability upgrade rather than part of first paint.
      photoUpgrades.push(upgradePhoto(admin, row.id, found.thumbnail));

      return found;
    });

    const startedAt = Date.now();
    console.log(
      `[generate-trip] Completed enrichment for "${destination}" in ${Date.now() - startedAt}ms: ` +
        `${inserted}/${locations.length} spots with verified photos ` +
        `(${photoMisses} without a photo, ${insertFailures} failed to save)`
    );

    if (inserted === 0) {
      // Name the actual fault. Both counters are reported because they have
      // opposite fixes: photo misses mean the search provider came back thin,
      // insert failures mean the database rejected the row.
      if (insertFailures > 0) {
        return await fail(
          DECK_FAILURE.STORAGE_FAULT,
          `Found ${locations.length} photo-verified places but could not save any of them ` +
            `(${insertFailures} database insert${insertFailures === 1 ? "" : "s"} failed). ` +
            `This is a storage fault, not a missing-photo problem — check the trip_cards schema ` +
            `against the deployed function.`
        );
      }
      // The one case where "this destination has little to show" is a fact
      // rather than a guess: the search ran, and every result it returned was
      // rejected for want of a usable photo. This is the only code the client is
      // permitted to render as a thin destination.
      return await fail(
        DECK_FAILURE.NO_PHOTO_RESULTS,
        `No location had a usable photo (${photoMisses}/${locations.length} searched).`
      );
    }

    if (insertFailures > 0) {
      console.warn(
        `[generate-trip] Deck for "${destination}" is partial: ${insertFailures} photo-verified ` +
          `places could not be saved and are missing from the deck.`
      );
    }

    await admin.updateDeck(deckId, { status: "ready", card_count: inserted });

    return json({ deckId, isGenerator: true, status: "ready", generated: true, count: inserted });
  } catch (err) {
    return await fail(DECK_FAILURE.UNKNOWN, String(err));
  }
});
