/**
 * What the app is allowed to say when a deck does not arrive.
 *
 * The failure this exists to prevent: a deck came back with no cards, nothing
 * could explain why, and the UI reached for the nearest available story --
 * "limited photo-verified places found for {destination}" -- and told the
 * traveller their destination was to blame. It wasn't. Twelve cards had been
 * generated correctly and written under a key the client was not reading. The
 * message was not a guess the traveller could discount; it was a confident
 * falsehood that sent the debugging in the wrong direction.
 *
 * So the rule this module enforces is narrow and deliberate: a cause may only
 * be stated when the server stated it first. Every other path renders as
 * unknown, which is the truthful answer and is far more useful than a
 * confident wrong one.
 *
 * Copy is written for the traveller. No stack traces, no provider names, no
 * deck keys: the server's `error_message` is the diagnostic, and it stays in
 * the logs where it belongs.
 */

/** Failure reasons the client can recognise on its own, before the server speaks. */
export const CLIENT_FAILURE = {
  /** The deck query itself failed. Network, permissions, or an outage. */
  READ_FAILED: "read_failed",
  /** The request to the generator never completed. */
  UNREACHABLE: "unreachable",
  /** No session, so nothing can be generated on this device. */
  NOT_SIGNED_IN: "not_signed_in",
  /** Another traveller holds the generation claim. */
  OTHER_USER_GENERATING: "other_user_generating",
  /**
   * The pipeline finished and delivered no cards, and nothing recorded why.
   *
   * This is the honest shape of our stale-deploy incident, and the reason the
   * thin-destination copy below is gated so tightly.
   */
  UNEXPLAINED_EMPTY: "unexplained_empty",
};

/** Failure reasons the server writes, mirrored from the edge function's DECK_FAILURE. */
export const DECK_FAILURE = {
  NO_PHOTO_RESULTS: "no_photo_results",
  NO_LOCATIONS: "no_locations",
  STORAGE_FAULT: "storage_fault",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  CLAIM_FAILED: "claim_failed",
  DECK_KEY_MISMATCH: "deck_key_mismatch",
  UNKNOWN: "unknown",
};

/**
 * The two reasons we may honestly blame the destination.
 *
 * Both are cases where the server ran the search and came back with nothing
 * usable, which is a fact about the destination rather than an inference from
 * an empty array. Nothing else in this file may imply the destination is thin.
 */
const THIN_DESTINATION_CODES = new Set([
  DECK_FAILURE.NO_PHOTO_RESULTS,
  DECK_FAILURE.NO_LOCATIONS,
]);

/**
 * True only when the server has actually established that this destination
 * came back empty.
 *
 * Every caller that wants to say "there isn't much there" must ask this first.
 * It answers false for every unknown, which is the point.
 */
export function isThinDestination(code) {
  return THIN_DESTINATION_CODES.has(code);
}

/**
 * Renders a failure as traveller-facing copy.
 *
 * `destination` is interpolated only by the thin-destination branch, because
 * that is the only branch where naming the destination is a statement of fact.
 *
 * Returns null for a null code: no code means the pipeline succeeded and any
 * empty deck is a question about the cache, not a failure to report.
 */
export function describeDeckFailure(code, destination) {
  switch (code) {
    case DECK_FAILURE.NO_PHOTO_RESULTS:
      return `We searched ${destination || "this destination"} and couldn't find anywhere with a photo we can use.`;

    case DECK_FAILURE.NO_LOCATIONS:
      return `We couldn't find anywhere to suggest in ${destination || "this destination"}.`;

    case DECK_FAILURE.PROVIDER_UNAVAILABLE:
      return "Our trip planner isn't responding right now. Nothing's wrong with your trip.";

    case DECK_FAILURE.STORAGE_FAULT:
      return "We found places for you but couldn't save them. That's on us, not on your trip.";

    case DECK_FAILURE.CLAIM_FAILED:
      return "We couldn't start building your deck. Please try again in a moment.";

    case DECK_FAILURE.DECK_KEY_MISMATCH:
      // Worth naming precisely: this one is diagnosable by us from the logs and
      // says nothing about the traveller's destination.
      return "We saved your deck but couldn't load it back. That's a bug on our side.";

    case CLIENT_FAILURE.READ_FAILED:
      return "We couldn't check whether your deck was ready. Check your connection and try again.";

    case CLIENT_FAILURE.UNREACHABLE:
      return "We couldn't reach the trip planner. Check your connection and try again.";

    case CLIENT_FAILURE.NOT_SIGNED_IN:
      return "Your session has expired. Sign in again to build your deck.";

    case CLIENT_FAILURE.OTHER_USER_GENERATING:
      return "Someone in your group is building this deck right now.";

    case CLIENT_FAILURE.UNEXPLAINED_EMPTY:
      return "Your deck finished building but we couldn't load it. That's a bug on our side.";

    case DECK_FAILURE.UNKNOWN:
      return "Something went wrong building your deck. That's on us, not on your trip.";

    default:
      // An unrecognised code is still a failure we cannot explain, so it reads
      // the same as any other unknown rather than defaulting to a cause.
      return "Something went wrong building your deck. That's on us, not on your trip.";
  }
}