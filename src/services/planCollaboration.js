import { supabase } from "../lib/supabase";

/**
 * Client side of the group voting loop: per-day votes, post-confirm
 * suggestions, and the two collective actions that need the service role
 * (confirm, rebuild-day) proxied through the plan-actions edge function.
 *
 * Majority rule, everywhere: a day is approved when more members voted
 * thumbs-up than thumbs-down AND at least half the membership voted at all.
 * The turnout floor is what stops one early voter from speaking for the group.
 */

const PLAN_ACTIONS_URL =
  import.meta.env.VITE_PLAN_ACTIONS_URL ||
  (import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/plan-actions`
    : "/api/plan-actions");

export function majorityNeeded(memberCount) {
  return Math.max(1, Math.ceil((memberCount || 1) / 2));
}

export function tallyDayVotes(votes, dayIndex) {
  const dayVotes = (votes || []).filter((v) => v.day_index === dayIndex);
  const up = dayVotes.filter((v) => v.vote === "up").length;
  const down = dayVotes.filter((v) => v.vote === "down").length;
  return { cast: dayVotes.length, up, down };
}

export function isDayApproved(votes, dayIndex, memberCount) {
  const { cast, up, down } = tallyDayVotes(votes, dayIndex);
  return cast >= majorityNeeded(memberCount) && up > down;
}

export function isDayRejected(votes, dayIndex, memberCount) {
  const { cast, up, down } = tallyDayVotes(votes, dayIndex);
  return cast >= majorityNeeded(memberCount) && down > up;
}

export function votesForDay(votes, dayIndex) {
  return (votes || []).filter((v) => v.day_index === dayIndex);
}

export async function getTripDayVotes(tripId) {
  if (!tripId) return [];
  const { data, error } = await supabase
    .from("trip_day_votes")
    .select("*")
    .eq("trip_id", tripId);
  if (error) {
    console.warn("Error fetching day votes:", error.message);
    return [];
  }
  return data || [];
}

export async function saveDayVote({ tripId, userId, dayIndex, vote, reasons = [] }) {
  if (!tripId || !userId) return null;
  const { data, error } = await supabase
    .from("trip_day_votes")
    .upsert(
      {
        trip_id: tripId,
        user_id: userId,
        day_index: dayIndex,
        vote,
        reasons: vote === "down" ? reasons : [],
      },
      { onConflict: "trip_id,user_id,day_index" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function subscribeTripDayVotes(tripId, onChange) {
  if (!tripId) return () => {};
  const channel = supabase
    .channel(`trip-day-votes-${tripId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "trip_day_votes", filter: `trip_id=eq.${tripId}` },
      onChange,
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/**
 * The reveal card's "we analysed" numbers, provided by the planner. Stored on
 * the plan row so every member sees the same figures.
 */
export function revealStats(plan) {
  const stats = plan?.stats;
  if (!stats || typeof stats !== "object") return null;
  return {
    travellers: Number(stats.travellers) || 0,
    preferences: Number(stats.preferences) || 0,
    shared: Number(stats.shared) || 0,
  };
}

export function isRevealDismissed(tripId) {
  if (!tripId) return true;
  try {
    return localStorage.getItem(`tripder-reveal-${tripId}`) === "1";
  } catch {
    return false;
  }
}

export function dismissReveal(tripId) {
  if (!tripId) return;
  try {
    localStorage.setItem(`tripder-reveal-${tripId}`, "1");
  } catch {
    // Private mode; the card just shows again next visit.
  }
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  };
}

export async function callPlanAction({ tripId, action, dayIndex, reasons, expectedRebuildCount }) {
  const res = await fetch(PLAN_ACTIONS_URL, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ tripId, action, dayIndex, reasons, expectedRebuildCount }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(payload.error || `Plan action failed (${res.status})`);
    error.payload = payload;
    error.status = res.status;
    throw error;
  }
  return payload;
}

/* ------------------------------------------------------------------ *
 * Post-confirm suggestions
 * ------------------------------------------------------------------ */

export async function getPlanSuggestions(tripId) {
  if (!tripId) return [];
  const { data, error } = await supabase
    .from("plan_suggestions")
    .select("*, profiles:user_id(username), plan_suggestion_votes(*)")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("Error fetching suggestions:", error.message);
    return [];
  }
  return (data || []).map((suggestion) => ({
    ...suggestion,
    proposer_name: suggestion.profiles?.username || "a member",
    plan_suggestion_votes: suggestion.plan_suggestion_votes || [],
  }));
}

export async function createSuggestion({ tripId, userId, dayIndex, type, payload }) {
  const { data, error } = await supabase
    .from("plan_suggestions")
    .insert({ trip_id: tripId, user_id: userId, day_index: dayIndex, type, payload })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function voteOnSuggestion({ suggestionId, userId, vote }) {
  const { error } = await supabase
    .from("plan_suggestion_votes")
    .upsert(
      { suggestion_id: suggestionId, user_id: userId, vote },
      { onConflict: "suggestion_id,user_id" },
    );
  if (error) throw error;
}

export async function setSuggestionStatus(id, status) {
  const { error } = await supabase
    .from("plan_suggestions")
    .update({ status })
    .eq("id", id);
  if (error) throw error;
}

export function subscribePlanSuggestions(tripId, onChange) {
  if (!tripId) return () => {};
  const channel = supabase
    .channel(`plan-suggestions-${tripId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "plan_suggestions", filter: `trip_id=eq.${tripId}` },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "plan_suggestion_votes" },
      onChange,
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function tallySuggestionVotes(suggestion) {
  const votes = suggestion?.plan_suggestion_votes || [];
  const up = votes.filter((v) => v.vote === "up").length;
  const down = votes.filter((v) => v.vote === "down").length;
  return { cast: votes.length, up, down };
}

export function isSuggestionPassed(suggestion, memberCount) {
  const { cast, up, down } = tallySuggestionVotes(suggestion);
  return suggestion?.status === "open" && cast >= majorityNeeded(memberCount) && up > down;
}

export function mySuggestionVote(suggestion, userId) {
  return (suggestion?.plan_suggestion_votes || []).find((v) => v.user_id === userId)?.vote || null;
}
