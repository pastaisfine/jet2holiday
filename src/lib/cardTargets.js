/**
 * How many swipe cards a trip of a given length should produce.
 *
 * The deck is sized from trip length because a swiper's effort should scale
 * with the trip they are planning: one day is a short list, a week is a real
 * decision. Before this the count came from the model's own guess at how big
 * the destination is, which meant a 2-day and a 12-day trip to the same city
 * got the same deck.
 *
 * The edge function holds a copy of this table because it cannot import from
 * `src/` (the deploy bundles the function directory alone). The two must agree
 * byte for byte, or the client and the generator size the same trip
 * differently — `cardTargets.test.js` fails the build when they drift.
 */
export const CARD_TARGETS = Object.freeze({
  1: 4,
  2: 7,
  3: 10,
  4: 15,
  5: 19,
  6: 25,
});

/**
 * Days a trip lasts when the traveller never picked dates.
 *
 * Dates are optional, so generation is skipped entirely without them and the
 * fallback deck is shown instead. This default only covers trips that predate
 * the required-target work — a resumed trip saved before dates were captured —
 * where a wrong-but-sensible size beats refusing to generate.
 */
export const DEFAULT_TRIP_DAYS = 3;

/** Past the literal table the count grows linearly, four cards per extra day. */
const LONG_TRIP_SLOPE = 4;
const LONG_TRIP_ANCHOR_DAYS = 6;

/**
 * The model keeps its judgement: it is told the target and may return more or
 * fewer depending on what the destination actually offers. This ceiling exists
 * only to stop a generous model (or a long trip) from returning something we
 * would spend minutes enriching, so it is deliberately loose at +50%.
 */
const CAP_MULTIPLIER = 1.5;

/**
 * Coerces anything a caller might hold to a day count.
 *
 * Absence and nonsense both fall back to the default rather than to 1 day:
 * `Number(null)` and `Number("")` are both 0, which would otherwise read as a
 * deliberate one-day trip and quietly shrink the deck to four cards.
 */
export function normaliseDays(days) {
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
export function cardTargetForDays(days) {
  const d = normaliseDays(days);
  if (d <= LONG_TRIP_ANCHOR_DAYS) return CARD_TARGETS[d];
  return CARD_TARGETS[LONG_TRIP_ANCHOR_DAYS] + LONG_TRIP_SLOPE * (d - LONG_TRIP_ANCHOR_DAYS);
}

/** Hard ceiling on how many cards a trip of this length may produce. */
export function cardCapForDays(days) {
  return Math.round(cardTargetForDays(days) * CAP_MULTIPLIER);
}