import { supabase } from "../lib/supabase";

export async function analyzePreferences({
  profile,
  initialPreferences,
  destination,
  swipes,
}) {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error("User is not authenticated.");
  }

  const { data, error } = await supabase.functions.invoke("preference", {
    body: {
      profile,
      initialPreferences,
      destination,
      swipes,
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Preference Agent returned no data.");
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

// The agent speaks camelCase, the table speaks snake_case. Mapping lives here
// rather than at the call site so the two shapes cannot drift apart.
const toRow = ({ summary, metadata, userId, tripId, destination }) => ({
  user_id: userId,
  trip_id: tripId || null,
  destination,
  style_name: summary.styleName || "",
  tagline: summary.tagline || "",
  interests: summary.interests || [],
  dislikes: summary.dislikes || [],
  pace: summary.pace || "",
  dining_preference: summary.diningPreference || "",
  budget_preference: summary.budgetPreference || "",
  dietary_constraints: summary.dietaryConstraints || [],
  priorities: summary.priorities || [],
  constraints: summary.constraints || [],
  reasoning_insights: summary.reasoningInsights || [],
  swipe_count: metadata?.swipeCount || 0,
  // The evidence, not just the conclusions drawn from it. Without these the
  // client has to reconstruct the category breakdown by pattern-matching the
  // agent's prose, which is how the bars came to disagree with the title above
  // them. See migration 20261008_preference_evidence.
  category_tally: metadata?.categoryTally || null,
  reason_tally: metadata?.reasonTally || null,
  reasoned_swipe_count: metadata?.reasonedSwipeCount || 0,
});

// The places a traveller actually swiped right on, with the category each was
// filed under.
//
// Read separately from the summary because the summary is an interpretation and
// this is the evidence. The ideal-day preview is only worth showing if its stops
// are places the user really liked, so it is built from the swipes rather than
// from anything the model wrote.
//
// Scoped to the trip for the same reason the analysis is (see SwipeScreen): a
// destination is only a city name, so filtering on it alone would reach back
// into every trip the user has ever taken there.
export async function getLikedSwipes({ tripId, destination }) {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  const userId = sessionData?.session?.user?.id;

  if (!userId) {
    return [];
  }

  let query = supabase
    .from("swipes")
    .select("card_name, category")
    .eq("user_id", userId)
    .eq("direction", "like");

  query = tripId
    ? query.eq("trip_id", tripId)
    : query.eq("destination", destination);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  // Renamed on the way out. The column is card_name because a swipe row also
  // carries a free-text `reason`, so the place it referred to needed
  // disambiguating there; the consumer here only ever wants the place, and
  // silently returning the wrong field name would drop every card.
  return (data || []).map((row) => ({
    name: row.card_name,
    category: row.category,
  }));
}

/**
 * The stored analysis for this traveller on this trip, or null.
 *
 * Read by the profile screen in preference to the sessionStorage hand-off. That
 * copy is tab-scoped and written by the swipe screen on its way past; this is
 * the durable record the group planner will read too, so a refresh or a second
 * tab shows the same evidence rather than falling back to guessing at the bars.
 *
 * Scoped to the trip for the same reason the analysis is: a destination is only
 * a city name, so filtering on it alone would return whichever trip happened to
 * be written last.
 */
export async function getPreferenceSummary({ tripId, destination }) {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  const userId = sessionData?.session?.user?.id;

  if (!userId) {
    return null;
  }

  let query = supabase
    .from("preference_summaries")
    .select(
      "style_name, tagline, pace, budget_preference, dining_preference, interests, dislikes, priorities, reasoning_insights, swipe_count, category_tally, reason_tally, reasoned_swipe_count"
    )
    .eq("user_id", userId);

  query = tripId
    ? query.eq("trip_id", tripId)
    : query.is("trip_id", null).eq("destination", destination);

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

// Persist the agent's output so it outlives the tab that produced it. Re-running
// the analysis overwrites in place: there is one current summary per traveller
// per trip, and that is the only one the group planner should ever read.
export async function savePreferenceSummary({
  summary,
  metadata,
  tripId,
  destination,
}) {
  if (!summary) {
    throw new Error("Cannot save a preference summary without a summary.");
  }

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  const userId = sessionData?.session?.user?.id;

  if (!userId) {
    throw new Error("User is not authenticated.");
  }

  const row = toRow({ summary, metadata, userId, tripId, destination });

  // Uniqueness is enforced by two partial unique indexes, and PostgREST's
  // on_conflict cannot name a partial index -- so the existing row is looked up
  // first. A concurrent second tab still loses at the index rather than
  // duplicating, which is the outcome we want anyway.
  let existingQuery = supabase
    .from("preference_summaries")
    .select("id")
    .eq("user_id", userId);

  existingQuery = tripId
    ? existingQuery.eq("trip_id", tripId)
    : existingQuery.is("trip_id", null).eq("destination", destination);

  const { data: existingRow, error: lookupError } =
    await existingQuery.maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  const { error } = existingRow
    ? await supabase
        .from("preference_summaries")
        .update(row)
        .eq("id", existingRow.id)
    : await supabase.from("preference_summaries").insert(row);

  if (error) {
    throw error;
  }
}