import { useSyncExternalStore } from "react";
import { supabase } from "../lib/supabase";
import { getDayRoute, optimizeDayOrder } from "./mapbox";
import { scheduleDay } from "../lib/scheduler";

const PROXY_URL =
  import.meta.env.VITE_GROUP_PLANNER_URL ||
  (import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/group-planner`
    : "/api/group-planner");

/**
 * Pipeline store for the group plan, modelled on generateTrip.js.
 *
 * Phases:
 *   idle       nothing loaded
 *   loading    reading the stored plan row
 *   planning   the Group Planner + Itinerary Agents are working (edge function)
 *   scheduling Mapbox routing + deterministic timing is running (client)
 *   ready      validated_plan exists and is on screen
 *   error
 */
let state = {
  tripId: null,
  phase: "idle",
  plan: null,
  error: null,
  scheduleProgress: null,
};

const listeners = new Set();
let channel = null;
let subscribedTripId = null;
let schedulePromise = null;
let scheduleTripId = null;

function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return state;
}

export function useGroupPlan() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function resetGroupPlan() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
    subscribedTripId = null;
  }
  schedulePromise = null;
  scheduleTripId = null;
  state = { tripId: null, phase: "idle", plan: null, error: null, scheduleProgress: null };
  listeners.forEach((fn) => fn());
}

async function fetchPlanRow(tripId) {
  const { data, error } = await supabase
    .from("trip_plans")
    .select("*")
    .eq("trip_id", tripId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function paceOf(plan) {
  const style = plan?.group_profile?.trip_style;
  if (style === "relaxed" || style === "fast-paced") return style === "relaxed" ? "relaxed" : "fast";
  return "balanced";
}

/**
 * Turns the itinerary agent's day assignments into a routed, timed plan.
 *
 * Mapbox orders the stops (Optimization API) and returns travel time and
 * geometry (Directions API); scheduleDay then lays clock times on top from
 * those durations. When Mapbox is unavailable the day keeps the agent's order
 * and scheduleDay falls back to distance estimates, so the plan is always
 * produced, never blocked.
 */
async function buildValidatedPlan(plan) {
  const candidate = plan?.candidate_pois;
  if (!candidate?.days) return null;

  const pace = paceOf(plan);
  const days = [];

  for (const day of candidate.days) {
    const stops = Array.isArray(day.stops) ? day.stops : [];
    let ordered = stops;
    let route = null;

    if (stops.length >= 2) {
      const coords = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
      const order = await optimizeDayOrder(coords, day.transport_mode);
      if (order) ordered = order.map((index) => stops[index]);
      route = await getDayRoute(
        ordered.map((s) => ({ lat: s.lat, lng: s.lng })),
        day.transport_mode,
      );
    }

    const schedule = scheduleDay({
      stops: ordered.map((s) => ({
        id: s.card_id,
        name: s.name,
        category: s.category,
        area: s.area,
        description: s.description,
        img: s.img,
        lat: s.lat,
        lng: s.lng,
        estimatedDuration: s.estimated_duration_min,
        rating: s.rating,
        why: s.why,
      })),
      legs: route?.legs || [],
      transportMode: day.transport_mode,
      pace,
    });

    days.push({
      day_index: day.day_index,
      date: day.date,
      title: day.title,
      transport_mode: day.transport_mode,
      geometry: route?.geometry || null,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      totalMinutes: schedule.totalMinutes,
      travelMinutes: schedule.travelMinutes,
      overflow: schedule.overflow,
      stops: schedule.stops,
    });
  }

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    pace,
    days,
    unassigned: candidate.unassigned || [],
  };
}

async function persistValidatedPlan(tripId, validatedPlan) {
  const { error } = await supabase
    .from("trip_plans")
    .update({ validated_plan: validatedPlan })
    .eq("trip_id", tripId);

  if (error) throw error;
}

function handleIncomingRow(row) {
  if (!row || row.trip_id !== state.tripId) return;

  emit({ plan: row });

  if (row.status === "pending") {
    emit({ phase: "planning", error: null });
    return;
  }

  if (row.status === "failed") {
    emit({ phase: "error", error: row.error_message || "Plan generation failed." });
    return;
  }

  if (row.status === "ready" && row.candidate_pois && !row.validated_plan) {
    // Someone (possibly another member) has produced candidate days; routing
    // and scheduling are per-device work, so whoever is looking does it.
    runScheduler(row);
    return;
  }

  if (row.status === "ready" && row.validated_plan) {
    emit({ phase: "ready", error: null, scheduleProgress: null });
    return;
  }

  // A confirmed plan is still a readable plan: phase 'ready' just means "the
  // itinerary is on screen", the status column carries the voting state.
  if (row.status === "confirmed" && row.validated_plan) {
    emit({ phase: "ready", error: null, scheduleProgress: null });
  }
}

function ensureSubscription(tripId) {
  if (subscribedTripId === tripId && channel) return;

  if (channel) {
    const stale = channel;
    channel = null;
    subscribedTripId = null;
    supabase.removeChannel(stale);
  }
  subscribedTripId = tripId;

  // Unique topic per subscription: removeChannel is async, so reusing the
  // topic name can race a still-registered channel and throw "cannot add
  // callbacks after subscribe()" on the next .on().
  channel = supabase
    .channel(`trip-plan-${tripId}-${Date.now()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "trip_plans", filter: `trip_id=eq.${tripId}` },
      (payload) => {
        // INSERT carries the full row; UPDATE carries new; guard both.
        handleIncomingRow(payload.new || null);
      },
    )
    .subscribe();
}

function runScheduler(plan) {
  // One in-flight scheduling pass per trip. A pass for another trip must not
  // be returned to this caller (it would never schedule this row), and its
  // result must not be emitted onto whichever trip happens to be open now.
  if (schedulePromise && scheduleTripId === plan.trip_id) return schedulePromise;

  emit({ phase: "scheduling", error: null, scheduleProgress: 0 });

  scheduleTripId = plan.trip_id;
  const promise = (async () => {
    const emitForTrip = (patch) => {
      if (state.tripId === plan.trip_id) emit(patch);
    };

    try {
      const validated = await buildValidatedPlan(plan);
      if (!validated) throw new Error("The plan has no itinerary days to schedule.");

      emitForTrip({ scheduleProgress: validated.days.length });
      await persistValidatedPlan(plan.trip_id, validated);
      emitForTrip({
        phase: "ready",
        error: null,
        scheduleProgress: null,
        plan: { ...plan, validated_plan: validated },
      });
    } catch (err) {
      emitForTrip({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
        scheduleProgress: null,
      });
    } finally {
      if (schedulePromise === promise) {
        schedulePromise = null;
        scheduleTripId = null;
      }
    }
  })();

  schedulePromise = promise;
  return promise;
}

/** Loads the stored plan for a trip and starts watching it. */
export async function loadGroupPlan(tripId) {
  if (!tripId) return;

  emit({ tripId, phase: "loading", error: null });
  ensureSubscription(tripId);

  try {
    const plan = await fetchPlanRow(tripId);
    if (!plan) {
      emit({ plan: null, phase: "idle" });
      return;
    }

    emit({ plan });
    handleIncomingRow(plan);
  } catch (err) {
    emit({ phase: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Kicks off the Group Planner + Itinerary Agents for a trip. Resolves when the
 * row is readable; scheduling may still be running (phase 'scheduling').
 */
export async function startGroupPlan({ tripId, force = false } = {}) {
  if (!tripId) return;

  ensureSubscription(tripId);
  emit({ tripId, phase: "planning", error: null, scheduleProgress: null });

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    emit({ phase: "error", error: "Not signed in" });
    return;
  }

  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ tripId, force }),
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok || payload.status === "failed") {
      emit({ phase: "error", error: payload.error || `Group planner failed (${res.status})` });
      return;
    }

    const plan = await fetchPlanRow(tripId);
    emit({ plan });

    if (plan) {
      handleIncomingRow(plan);
    } else if (payload.status === "pending") {
      // Another member holds the claim; Realtime will deliver the row.
      emit({ phase: "planning" });
    }
  } catch (err) {
    emit({
      phase: "error",
      error: err instanceof Error ? err.message : "Could not reach the group planner.",
    });
  }
}

export async function regenerateGroupPlan(tripId) {
  return startGroupPlan({ tripId, force: true });
}

/**
 * Rebuilds one day after a manual edit (reorder, add, replace, remove) using
 * the same routing + scheduling path as generation, then persists the whole
 * validated plan so every member sees the edit.
 *
 * `keepOrder` is true for user reorders: their order is respected and only the
 * travel times are re-fetched. Adds and replacements keep their position too.
 */
export async function rerouteDay({ day, stops, keepOrder = true }) {
  const coords = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  let ordered = stops;

  if (!keepOrder && stops.length >= 3) {
    const order = await optimizeDayOrder(coords, day.transport_mode);
    if (order) ordered = order.map((index) => stops[index]);
  }

  const route = ordered.length >= 2
    ? await getDayRoute(ordered.map((s) => ({ lat: s.lat, lng: s.lng })), day.transport_mode)
    : null;

  const schedule = scheduleDay({
    stops: ordered,
    legs: route?.legs || [],
    transportMode: day.transport_mode,
    pace: paceOf(state.plan),
  });

  return {
    ...day,
    geometry: route?.geometry || null,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    totalMinutes: schedule.totalMinutes,
    travelMinutes: schedule.travelMinutes,
    overflow: schedule.overflow,
    stops: schedule.stops,
  };
}

/** Persists an edited validated plan and updates subscribers. */
export async function saveValidatedPlan(tripId, validatedPlan) {
  await persistValidatedPlan(tripId, validatedPlan);
  emit({ plan: { ...state.plan, validated_plan: validatedPlan } });
}

/** The validated plan for one day, or null. */
export function getPlanDay(plan, dayIndex) {
  return plan?.validated_plan?.days?.find((d) => d.day_index === dayIndex) || null;
}
