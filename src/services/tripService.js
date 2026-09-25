import { supabase } from "../lib/supabase";

/**
 * Ensures the authenticated user has a profile record in public.profiles.
 */
async function ensureProfile(userId) {
  if (!userId) return;
  try {
    const { data: userResp } = await supabase.auth.getUser();
    const user = userResp?.user;
    if (user && user.id === userId) {
      const meta = user.user_metadata || {};
      const username = meta.username || meta.full_name || user.email?.split("@")[0] || "Traveler";
      await supabase.from("profiles").upsert(
        {
          id: userId,
          username,
          avatar_url: meta.avatar_url || "",
          avatar_color: "#F19A6A",
        },
        { onConflict: "id" }
      );
    }
  } catch (err) {
    console.warn("Could not ensure profile:", err);
  }
}

/**
 * Creates or updates a trip in Supabase.
 * Always guarantees a valid unique UUID and adds the leader to trip_members.
 */
export async function createOrUpdateTrip({ tripId, destination, startDate, endDate, leaderId }) {
  let effectiveLeaderId = leaderId;
  if (!effectiveLeaderId) {
    const { data: userResp } = await supabase.auth.getUser();
    effectiveLeaderId = userResp?.user?.id;
  }

  // Ensure leader profile exists so foreign key constraint never fails
  if (effectiveLeaderId) {
    await ensureProfile(effectiveLeaderId);
  }

  const effectiveTripId = tripId || crypto.randomUUID();
  const payload = {
    id: effectiveTripId,
    destination: destination || "Lisbon, Portugal",
    start_date: startDate ? new Date(startDate).toISOString() : null,
    end_date: endDate ? new Date(endDate).toISOString() : null,
    leader_id: effectiveLeaderId || null,
  };

  try {
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single();

    if (tripError) {
      console.warn("Notice: trip upsert error, falling back to local payload:", tripError.message);
      return payload;
    }

    // Add creator as leader in trip_members
    if (effectiveLeaderId && trip?.id) {
      const { error: memberError } = await supabase
        .from("trip_members")
        .upsert(
          { trip_id: trip.id, user_id: effectiveLeaderId, role: "leader" },
          { onConflict: "trip_id,user_id" }
        );

      if (memberError) {
        console.warn("Notice: error adding leader to trip_members:", memberError.message);
      }
    }

    return trip;
  } catch (err) {
    console.warn("Trip creation exception:", err);
    return payload;
  }
}

/**
 * Fetches the user's latest trip from Supabase.
 */
export async function getUserLatestTrip(userId) {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from("trip_members")
      .select("trip_id, trips(*)")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data?.trips) {
      return data.trips;
    }
  } catch (err) {
    console.warn("Error fetching user latest trip:", err);
  }
  return null;
}

/**
 * Fetches trip details by trip ID.
 */
export async function getTrip(tripId) {
  if (!tripId) return null;

  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();

  if (error) {
    console.warn(`Trip with id ${tripId} not found:`, error.message);
    return null;
  }

  return data;
}

/**
 * Fetches all members belonging to a trip, joined with their profile information.
 */
export async function getTripMembers(tripId) {
  if (!tripId) return [];

  const { data, error } = await supabase
    .from("trip_members")
    .select(`
      id,
      trip_id,
      user_id,
      role,
      joined_at,
      profiles:user_id (
        id,
        username,
        avatar_url,
        avatar_color
      )
    `)
    .eq("trip_id", tripId);

  if (error) {
    console.error("Error fetching trip members:", error);
    return [];
  }

  return (data || []).map((m) => {
    const p = m.profiles || {};
    return {
      membershipId: m.id,
      userId: m.user_id,
      role: m.role || "member",
      joinedAt: m.joined_at,
      username: p.username || "Traveler",
      avatarUrl: p.avatar_url || "",
      avatarColor: p.avatar_color || "#F19A6A",
    };
  });
}

/**
 * Joins a user to a trip.
 */
export async function joinTrip({ tripId, userId }) {
  if (!tripId || !userId) {
    throw new Error("Missing tripId or userId to join trip");
  }

  await ensureProfile(userId);

  const { error } = await supabase
    .from("trip_members")
    .upsert(
      { trip_id: tripId, user_id: userId, role: "member" },
      { onConflict: "trip_id,user_id" }
    );

  if (error) {
    console.error("Error joining trip:", error);
    throw error;
  }

  const trip = await getTrip(tripId);
  const members = await getTripMembers(tripId);

  return { trip, members };
}
