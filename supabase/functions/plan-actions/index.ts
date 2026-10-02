import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Collective actions on a shared plan that need service-role writes:
//
//   confirm     the leader's atomic "close voting & confirm plan"
//   rebuild-day the Itinerary Agent rebuilding one day from the group's
//               downvote reasons, capped at three attempts per day
//
// Votes themselves are plain table writes from the client; these actions are
// here because the client cannot write plan status, delete other members'
// votes, or call Gemini.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_DAY_REBUILDS = 3;

const GEMINI_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash",
];

const GEMINI_TIMEOUT_MS = 45_000;
const GEMINI_PER_MODEL_ATTEMPTS = 2;

type PlanStop = {
  card_id: string;
  name: string;
  category: string;
  area: string;
  lat: number | null;
  lng: number | null;
  [key: string]: unknown;
};

type PlanDay = {
  day_index: number;
  date: string | null;
  title: string;
  transport_mode: string;
  stops: PlanStop[];
};

type PlanRow = {
  trip_id: string;
  status: string;
  group_profile: Record<string, unknown> | null;
  candidate_pois: { days: PlanDay[]; unassigned: PlanStop[] } | null;
  validated_plan: Record<string, unknown> | null;
  rebuilds: Record<string, { count: number; reasons?: string[]; at?: string; changed?: string[] }> | null;
  updated_at: string;
};

type VoteRow = {
  user_id: string;
  day_index: number;
  vote: string;
  reasons: string[] | null;
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

  const patch = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`PATCH ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return true;
  };

  // Optimistic concurrency: the filter carries the updated_at we read, so a
  // concurrent write to the same row makes this a no-op instead of a
  // last-write-wins overwrite. Returns false when the row moved on.
  const patchIfUnchanged = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`PATCH ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0;
  };

  const remove = async (path: string) => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok) {
      throw new Error(`DELETE ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return true;
  };

  return { get, patch, patchIfUnchanged, remove };
}

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
                temperature: 0.4,
                maxOutputTokens,
                responseMimeType: "application/json",
              },
            }),
          },
        );

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          lastErrorBody = body;
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
        if (text.trim().length > 0) return text;
        lastStatus = "returned an empty response";
      } catch (err) {
        lastStatus = `exception: ${String(err).slice(0, 80)}`;
      }
    }
    perModel.push(`${model}: ${lastStatus}`);
  }

  throw new Error(
    `Gemini unavailable across ${GEMINI_MODELS.length} models. Per-model: ${perModel.join(" | ")}. Last response: ${lastErrorBody.slice(0, 300)}`,
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

const MAJORITY = (memberCount: number) => Math.ceil(memberCount / 2);

function tallyDay(votes: VoteRow[], dayIndex: number) {
  const dayVotes = votes.filter((v) => v.day_index === dayIndex);
  const up = dayVotes.filter((v) => v.vote === "up").length;
  const down = dayVotes.filter((v) => v.vote === "down").length;
  return { cast: dayVotes.length, up, down };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SECRET_KEY = resolveSecretKey();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SECRET_KEY) {
    return json({ error: "Supabase credentials not configured" }, 500);
  }

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
    tripId?: string;
    action?: string;
    dayIndex?: number;
    reasons?: string[];
    expectedRebuildCount?: number;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const tripId = (body.tripId || "").trim();
  const action = (body.action || "").trim();
  if (!tripId || !action) return json({ error: "tripId and action are required" }, 400);

  const admin = adminClient(SUPABASE_URL, SECRET_KEY);

  try {
    const memberships = await admin.get(
      `trip_members?trip_id=eq.${encodeURIComponent(tripId)}&select=user_id,role`,
    ) as { user_id: string; role: string }[];

    const isMember = memberships.some((m) => m.user_id === userId);
    if (!isMember) return json({ error: "You are not a member of this trip." }, 403);

    const trips = await admin.get(
      `trips?id=eq.${encodeURIComponent(tripId)}&select=id,leader_id`,
    ) as { id: string; leader_id: string | null }[];
    const trip = trips[0];
    if (!trip) return json({ error: "Trip not found." }, 404);

    const plans = await admin.get(
      `trip_plans?trip_id=eq.${encodeURIComponent(tripId)}&select=*`,
    ) as PlanRow[];
    const plan = plans[0];
    if (!plan || !plan.candidate_pois?.days) {
      return json({ error: "This trip has no group plan yet." }, 404);
    }

    const votes = await admin.get(
      `trip_day_votes?trip_id=eq.${encodeURIComponent(tripId)}&select=user_id,day_index,vote,reasons`,
    ) as VoteRow[];

    const memberCount = memberships.length;
    const needed = MAJORITY(memberCount);

    if (action === "confirm") {
      if (trip.leader_id !== userId) {
        return json({ error: "Only the trip creator can confirm the plan." }, 403);
      }
      if (plan.status === "confirmed") {
        return json({ tripId, status: "confirmed", already: true });
      }
      if (plan.status !== "ready") {
        return json({ error: "The plan is not ready to confirm." }, 409);
      }

      const unapproved: number[] = [];
      for (const day of plan.candidate_pois.days) {
        const { cast, up, down } = tallyDay(votes, day.day_index);
        if (!(cast >= needed && up > down)) unapproved.push(day.day_index);
      }
      if (unapproved.length > 0) {
        return json(
          { error: "Every day needs a majority thumbs-up before the plan can be confirmed.", unapproved },
          409,
        );
      }

      const profiles = await admin.get(
        `profiles?id=eq.${encodeURIComponent(userId)}&select=username`,
      ) as { username: string }[];
      const confirmedBy = profiles[0]?.username || "The trip creator";
      const now = new Date().toISOString();

      if (plan.validated_plan) {
        await admin.patch(
          `trip_plans?trip_id=eq.${encodeURIComponent(tripId)}`,
          { validated_plan: { ...plan.validated_plan, confirmed_at: now, confirmed_by: confirmedBy } },
        );
      }

      await admin.patch(
        `trip_plans?trip_id=eq.${encodeURIComponent(tripId)}`,
        { status: "confirmed", confirmed_at: now, confirmed_by: confirmedBy },
      );

      return json({ tripId, status: "confirmed", confirmed_by: confirmedBy });
    }

    if (action === "rebuild-day") {
      const dayIndex = Number(body.dayIndex);
      if (!Number.isInteger(dayIndex) || dayIndex < 0) {
        return json({ error: "dayIndex is required." }, 400);
      }
      if (plan.status !== "ready") {
        return json({ error: "Voting is closed; the plan can no longer be rebuilt." }, 409);
      }

      const day = plan.candidate_pois.days.find((d) => d.day_index === dayIndex);
      if (!day) return json({ error: "That day does not exist in the plan." }, 404);

      const meta = plan.rebuilds?.[String(dayIndex)] ?? { count: 0 };
      const expected = Number(body.expectedRebuildCount);
      if (Number.isInteger(expected) && meta.count !== expected) {
        // Another member's client already rebuilt this day; treat as done.
        return json({ tripId, status: "stale", rebuilds: plan.rebuilds ?? {} });
      }
      if (meta.count >= MAX_DAY_REBUILDS) {
        return json(
          { error: `This day has been rebuilt ${MAX_DAY_REBUILDS} times — the group can settle it manually now.`, cap: true },
          409,
        );
      }

      const { cast, up, down } = tallyDay(votes, dayIndex);
      if (!(cast >= needed && down > up)) {
        return json({ error: "The group has not asked for a rebuild of this day.", stale: true }, 409);
      }
      if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY not configured" }, 500);

      const reasons = Array.isArray(body.reasons)
        ? body.reasons.filter((r): r is string => typeof r === "string").map((r) => r.trim()).filter(Boolean).slice(0, 8)
        : [];

      const pool: PlanStop[] = [...day.stops, ...(plan.candidate_pois.unassigned || [])];
      const poolByCardId = new Map(pool.map((stop) => [stop.card_id, stop]));

      const system = `You are the Itinerary Agent rebuilding ONE day of an existing group itinerary after the group voted it down.

You receive the group profile, the current day, the candidate places (the day's own stops plus the spare places the group liked but that are not scheduled), and the reasons members gave for rejecting the day.

Return exactly one JSON object:
{
  "title": string,
  "stops": [ { "card_id": string, "why": string } ]
}

Rules:
- Use ONLY card_id values from the candidate places. Never invent a place or id.
- 2-6 stops, but return fewer than the current day's count when a rejection reason says it was too packed.
- Directly address the rejection reasons: swap out stops that caused them and pull in candidates that fix them.
- Keep the group's shared priorities in mind; do not add places a member strongly avoided.
- "title" is a short human name for the rebuilt day (3-6 words).
- "why" is one short sentence tying the stop to the group profile or the reasons. No times, no distances.
- Return valid JSON only. No markdown. No explanation outside the JSON object.`;

      const prompt = `Group profile:
${JSON.stringify(plan.group_profile ?? {}, null, 2)}

Current day (rejected):
${JSON.stringify(day, null, 2)}

Candidate places (use these card_id values only):
${JSON.stringify(pool.map((s) => ({ card_id: s.card_id, name: s.name, category: s.category, area: s.area })), null, 2)}

Rejection reasons from the group:
${JSON.stringify(reasons)}

Rebuild the day now. Return the JSON object.`;

      const raw = await callGemini(GEMINI_API_KEY, system, prompt, 2048);
      let parsed: { title?: unknown; stops?: unknown } | null = null;
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        try {
          const text = attempt === 0 ? raw : await callGemini(GEMINI_API_KEY, system, prompt, 2048);
          parsed = JSON.parse(stripJsonFence(text));
        } catch {
          console.warn(`[plan-actions] rebuild-day parse attempt ${attempt + 1} failed`);
        }
      }
      if (!parsed) {
        return json({ error: "The Itinerary Agent returned invalid JSON. Try again." }, 502);
      }

      const rawStops = Array.isArray(parsed.stops) ? (parsed.stops as Record<string, unknown>[]) : [];
      const newStops: PlanStop[] = [];
      const usedIds = new Set<string>();
      for (const rawStop of rawStops) {
        const cardId = typeof rawStop.card_id === "string" ? rawStop.card_id : "";
        if (!cardId || usedIds.has(cardId)) continue;
        const stop = poolByCardId.get(cardId);
        if (!stop) continue;
        usedIds.add(cardId);
        newStops.push({
          ...stop,
          why: typeof rawStop.why === "string" ? rawStop.why.slice(0, 240) : stop.why,
        });
        if (newStops.length >= 6) break;
      }

      // Deterministic top-up, mirroring the main planner: a thin model answer
      // must not stop the group from getting a rebuilt day. Spare candidates
      // first, then the day's own displaced stops, best-rated first.
      if (newStops.length < 2) {
        const spare = [...(plan.candidate_pois.unassigned || []), ...day.stops]
          .filter((stop) => !usedIds.has(stop.card_id))
          .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
        for (const stop of spare) {
          if (newStops.length >= 2) break;
          usedIds.add(stop.card_id);
          newStops.push({
            ...stop,
            why: "Keeps the rebuilt day workable while the agents retry the rest.",
          });
        }
      }

      if (newStops.length < 2) {
        console.error(
          `[plan-actions] rebuild-day too thin for day ${dayIndex}. model stops:`,
          JSON.stringify(rawStops).slice(0, 400),
        );
        return json({ error: "The rebuilt day came back too thin. Try again." }, 502);
      }

      const rebuiltTitle = typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : day.title;
      const changed = newStops.map((s) => s.name);

      // Recompute the merge from whichever row is current, so a concurrent
      // rebuild of a different day is preserved rather than overwritten.
      const mergeFor = (fresh: PlanRow) => {
        const freshDay = fresh.candidate_pois?.days?.find((d) => d.day_index === dayIndex);
        if (!freshDay) return null;
        const displaced = freshDay.stops.filter((s) => !usedIds.has(s.card_id));
        const nextUnassigned = [
          ...((fresh.candidate_pois?.unassigned || []).filter((s) => !usedIds.has(s.card_id))),
          ...displaced.map((s) => ({ ...s, t: null, end: null, leg: null, late: false })),
        ];
        const nextDays = (fresh.candidate_pois?.days || []).map((d) =>
          d.day_index === dayIndex ? { ...d, title: rebuiltTitle, stops: newStops } : d
        );
        const freshMeta = fresh.rebuilds?.[String(dayIndex)] ?? { count: 0 };
        const rebuilds = {
          ...(fresh.rebuilds ?? {}),
          [String(dayIndex)]: {
            count: freshMeta.count + 1,
            reasons,
            at: new Date().toISOString(),
            changed,
          },
        };
        return { nextDays, nextUnassigned, rebuilds };
      };

      let saved = false;
      let latest: PlanRow = plan;
      for (let attempt = 0; attempt < 3 && !saved; attempt++) {
        if (attempt > 0) {
          const rows = await admin.get(
            `trip_plans?trip_id=eq.${encodeURIComponent(tripId)}&select=*`,
          ) as PlanRow[];
          if (!rows[0]) break;
          latest = rows[0];
        }

        const freshMeta = latest.rebuilds?.[String(dayIndex)] ?? { count: 0 };
        if (freshMeta.count !== meta.count) {
          // Another client already rebuilt this day while we were working.
          return json({ tripId, status: "stale", rebuilds: latest.rebuilds ?? {} });
        }

        const merged = mergeFor(latest);
        if (!merged) {
          return json({ error: "That day no longer exists in the plan." }, 409);
        }

        saved = await admin.patchIfUnchanged(
          `trip_plans?trip_id=eq.${encodeURIComponent(tripId)}&updated_at=eq.${encodeURIComponent(latest.updated_at)}`,
          {
            status: "ready",
            candidate_pois: { days: merged.nextDays, unassigned: merged.nextUnassigned },
            validated_plan: null,
            rebuilds: merged.rebuilds,
          },
        );
      }

      if (!saved) {
        return json(
          { tripId, status: "stale", error: "The plan changed while rebuilding. Try again." },
          409,
        );
      }

      // Votes reset for the day: the rebuilt day has to earn its own approval.
      await admin.remove(
        `trip_day_votes?trip_id=eq.${encodeURIComponent(tripId)}&day_index=eq.${dayIndex}`,
      );

      return json({
        tripId,
        status: "rebuilt",
        day_index: dayIndex,
        rebuild_count: meta.count + 1,
        reasons,
        changed,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[plan-actions] unexpected error:", err);
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});
