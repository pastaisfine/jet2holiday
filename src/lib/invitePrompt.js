/**
 * When to ask a trip leader to invite their crew.
 *
 * A trip row is only created on step 3 of setup, which means the invite link
 * does not exist while step 2 is still asking about the crew. The prompt
 * therefore cannot live on the setup screens; it lives on the deck, the first
 * screen that is guaranteed to run after the trip exists.
 *
 * Asking is only *useful* while nobody has joined. Once a second member is on
 * the trip the leader already has a crew, so the prompt would be pure noise --
 * and it closes itself the moment that member arrives, rather than waiting for
 * the leader to come back and reload.
 *
 * The rule is kept pure and free of Supabase and React so it can be tested
 * directly; the screen supplies the trip, the members and the dismissal flag.
 */

/**
 * True when this user leads this trip and is the only one in it.
 *
 * Leadership is read from either signal because the two are written
 * independently. `trips.leader_id` lands with the trip upsert, while the
 * `trip_members` leader row is a follow-up insert whose failure is deliberately
 * tolerated (see createOrUpdateTrip in tripService). Trusting either alone
 * would silently hide the prompt from a real leader on a real trip.
 */
export function shouldPromptForInvite({
  tripId,
  userId,
  leaderId,
  members = [],
  dismissed = false,
} = {}) {
  // No trip means no link to share, whatever the rest of the inputs say.
  if (!tripId || !userId) return false;

  // "Maybe later" is final for the trip. The state store already namespaces
  // localStorage per trip, so this never leaks into the next one.
  if (dismissed) return false;

  const rows = Array.isArray(members) ? members : [];

  // A member list that failed to load is not evidence of an empty trip. The
  // trip_members insert is tolerated-failed in a few paths, so an empty read
  // can mean "unknown" rather than "alone" -- and prompting a leader who
  // already has a crew is the worse error of the two.
  if (rows.length === 0) return false;

  // The leader already has company: stop asking.
  if (rows.length > 1) return false;

  const isLeader =
    (leaderId && String(leaderId) === String(userId)) ||
    rows.some(
      (m) =>
        m &&
        m.user_id === userId &&
        String(m.role || "").toLowerCase() === "leader",
    );

  return isLeader;
}

/**
 * Whether a membership change should retire the prompt permanently.
 *
 * A delete that leaves the trip empty should not count: the leader can still be
 * alone and still has nobody invited.
 */
export function shouldRetireInvitePrompt(members = []) {
  return Array.isArray(members) && members.length > 1;
}