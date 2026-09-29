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
      const { data: existingLeader } = await supabase
        .from("trip_members")
        .select("id")
        .eq("trip_id", trip.id)
        .eq("user_id", effectiveLeaderId)
        .maybeSingle();

      if (!existingLeader) {
        const { error: memberError } = await supabase
          .from("trip_members")
          .insert({ trip_id: trip.id, user_id: effectiveLeaderId, role: "leader" });

        if (memberError && !memberError.message?.includes("duplicate key")) {
          console.warn("Notice: error adding leader to trip_members:", memberError.message);
        }
      }
    }

    return trip;
  } catch (err) {
    console.warn("Trip creation exception:", err);
    return payload;
  }
}

/**
 * Persists the shared card deck for a trip so all members swipe the same places.
 */
export async function updateTripCards(tripId, cards) {
  if (!tripId || !cards) return;
  try {
    const { error } = await supabase
      .from("trips")
      .update({ cards: cards })
      .eq("id", tripId);
    if (error) console.warn("Could not update trip cards:", error.message);
  } catch (err) {
    console.warn("updateTripCards exception:", err);
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

  // Check if user is already a member before inserting
  const { data: existing, error: fetchErr } = await supabase
    .from("trip_members")
    .select("id, role")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing && !fetchErr) {
    const { error } = await supabase
      .from("trip_members")
      .insert({ trip_id: tripId, user_id: userId, role: "member" });

    if (error && !error.message?.includes("duplicate key")) {
      console.error("Error joining trip:", error);
      throw error;
    }
  }

  const trip = await getTrip(tripId);
  const members = await getTripMembers(tripId);

  return { trip, members };
}

/**
 * Fetches all swipes for a given trip, joining profile details for each user.
 */
export async function getTripSwipes(tripId) {
  if (!tripId) return [];
  try {
    const { data, error } = await supabase
      .from("swipes")
      .select("id, user_id, card_id, card_name, destination, direction, reasons, reason, swiped_at, trip_id")
      .eq("trip_id", tripId);

    if (error) {
      console.warn("Error fetching trip swipes:", error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn("getTripSwipes exception:", err);
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Curated decks
 *
 * A deck is a cached set of cards keyed by (destination + preferences) and
 * shared across trips. It is written one row at a time by the generate-trip
 * edge function, so clients render whatever has landed and keep rendering
 * while the rest streams in.
 * ------------------------------------------------------------------ */

/** Storage bucket for card photos, mirrored from the migration. */
export const PHOTO_BUCKET = "trip-photos";

/**
 * Stable cache key for a (destination, preferences) pair.
 *
 * Both sides of the wire must agree on this, so the edge function recomputes it
 * rather than trusting a client-supplied id. Destination is lowercased and
 * whitespace-collapsed so "Lisbon, Portugal" and " lisbon,  portugal " share a
 * cache entry.
 */
export function buildDeckId(destination, preferences) {
  const dest = (destination || "").trim().toLowerCase().replace(/\s+/g, " ");
  const prefs = normalizePreferences(preferences);
  return `${dest}::${prefs}`;
}

/**
 * Flattens the preference object into a stable string.
 *
 * Keys are sorted so `{a,b}` and `{b,a}` cannot produce two cache entries for
 * the same traveller, and array values are joined in order.
 */
function normalizePreferences(preferences) {
  if (!preferences || typeof preferences !== "object") return "";
  const parts = Object.keys(preferences)
    .sort()
    .map((key) => {
      const value = preferences[key];
      if (value == null) return "";
      if (Array.isArray(value)) return `${key}=${value.join(",")}`;
      return `${key}=${String(value)}`;
    })
    .filter(Boolean);
  return parts.join("|");
}

/**
 * Fetches a deck by its cache key, or null if nothing has been generated yet.
 */
export async function getDeck(deckId) {
  if (!deckId) return null;
  const { data, error } = await supabase
    .from("curated_decks")
    .select("*")
    .eq("id", deckId)
    .maybeSingle();

  if (error) {
    console.warn("Error fetching deck:", error.message);
    return null;
  }
  return data;
}

/**
 * Fetches the deck a trip is currently drawing from, or null.
 *
 * The client is read-only against all three deck tables: claiming, generating
 * and linking are the edge function's job, under the service role. Keeping
 * writes behind that boundary is what stops the client racing the generator
 * for a claim, and stops a trip link pointing at a deck row that does not
 * exist yet.
 */
export async function getTripDeckId(tripId) {
  if (!tripId) return null;
  const { data, error } = await supabase
    .from("trip_deck_links")
    .select("deck_id")
    .eq("trip_id", tripId)
    .maybeSingle();

  if (error) {
    console.warn("Error fetching trip deck link:", error.message);
    return null;
  }
  return data?.deck_id ?? null;
}

/**
 * Fetches a deck's cards, already ordered and in the card shape the UI wants.
 */
export async function getDeckCards(deckId) {
  if (!deckId) return [];
  const { data, error } = await supabase
    .from("trip_cards")
    .select("*")
    .eq("deck_id", deckId)
    .order("position", { ascending: true });

  if (error) {
    console.warn("Error fetching deck cards:", error.message);
    return [];
  }
  return (data || []).map(deckRowToCard);
}

/**
 * Maps a trip_cards row to the card shape consumed by SwipeCard.
 *
 * `img` prefers the storage copy and falls back to the hotlink. A row with
 * neither still produces a card: `img: ""` drives the placeholder render, so a
 * dead thumbnail costs us a picture rather than a whole suggestion.
 */
export function deckRowToCard(row) {
  const publicUrl = row.img_storage_path
    ? supabase.storage.from(PHOTO_BUCKET).getPublicUrl(row.img_storage_path).data.publicUrl
    : row.img_url;

  const category = row.category || "culture";
  return {
    id: row.place_id ? `gen-${row.place_id}` : `gen-${row.id}`,
    deckCardId: row.id,
    name: row.name,
    area: row.address || "",
    cat: [category.charAt(0).toUpperCase() + category.slice(1)],
    cost: typeof row.rating === "number" ? `★ ${row.rating}` : "—",
    img: publicUrl || "",
    blurb: row.description || "",
    // Generated cards have no crowd-sourced reasons, so the reason chips stay
    // empty rather than inventing endorsement data.
    likeR: [],
    noR: [],
    detail: [],
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    styleHint: row.style_hint || "balanced",
    rating: row.rating ?? null,
    address: row.address || "",
    generated: true,
  };
}

/**
 * Streams card inserts for a deck.
 * Returns an unsubscribe function.
 */
export function subscribeDeckCards(deckId, onCard) {
  if (!deckId) return () => {};
  const channel = supabase
    .channel(`deck-cards-${deckId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "trip_cards", filter: `deck_id=eq.${deckId}` },
      (payload) => onCard(deckRowToCard(payload.new))
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/**
 * Streams deck status changes. The flip to 'ready' is the definitive
 * end-of-generation signal that replaces the old SSE 'done' event, so callers
 * can stop their skeletons on a real answer instead of a timer.
 * Returns an unsubscribe function.
 */
export function subscribeDeckStatus(deckId, onStatus) {
  if (!deckId) return () => {};
  const channel = supabase
    .channel(`deck-status-${deckId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "curated_decks", filter: `id=eq.${deckId}` },
      (payload) => onStatus(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/**
 * Subscribe to realtime updates for swipes in a trip workspace.
 * Returns an unsubscribe function.
 */
export function subscribeTripSwipes(tripId, onUpdate) {
  if (!tripId) return () => {};
  const channel = supabase
    .channel(`trip-swipes-${tripId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "swipes", filter: `trip_id=eq.${tripId}` },
      onUpdate
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/**
 * Subscribe to realtime updates for members joining the trip.
 * Returns an unsubscribe function.
 */
export function subscribeTripMembers(tripId, onUpdate) {
  if (!tripId) return () => {};
  const channel = supabase
    .channel(`trip-members-${tripId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "trip_members", filter: `trip_id=eq.${tripId}` },
      onUpdate
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
