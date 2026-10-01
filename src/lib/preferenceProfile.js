// Every judgement the preference profile makes about a traveller, as pure
// functions.
//
// This module exists because the numbers on that screen used to be assembled
// inside a React component: buckets hardcoded in a useMemo, a denominator
// invented on the spot, and five fixed rows rendered whether or not anything
// had been swiped. That produced the contradiction the screen is built to
// avoid -- a "Nature Explorer" title above a "Scenic Views 0%" bar -- and none
// of it was reachable from a test.
//
// The vocabulary here is the six-value category enum that generate-trip writes
// onto trip_cards and swipes (supabase/migrations/20261006_swipe_category.sql).
// It is deliberately not a parallel set of display buckets: a bar the user can
// see must be backed by a category the system actually stores, or the screen is
// describing something that does not exist.

// Mirrors CATEGORY_TO_STYLE in supabase/functions/generate-trip and the
// swipes_category_check constraint. Keep in step with both.
export const CATEGORIES = [
  "food",
  "culture",
  "nature",
  "shopping",
  "nightlife",
  "wellness",
];

// The enum says what a place *is*; these say what a traveller is drawn to.
// "food" is not a preference, "Food & Markets" is.
export const CATEGORY_LABELS = {
  food: "Food & Markets",
  culture: "Arts & Culture",
  nature: "Nature & Outdoors",
  shopping: "Shopping",
  nightlife: "Nightlife",
  wellness: "Wellness",
};

export function describeCategory(category) {
  return CATEGORY_LABELS[category] || "Other";
}

// Every function below takes data that has been through Supabase, and PostgREST
// spells "absent" as null rather than undefined -- a JSONB column that was
// never written comes back null, not missing. A default parameter only covers
// undefined, so these guards are what stop a null column from becoming a blank
// screen on the profile.
const asArray = (value) =>
  Array.isArray(value) ? value : [];

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

/**
 * The share of a traveller's likes that each category accounts for.
 *
 * Two decisions here are the whole point of the module:
 *
 *  - A category with no likes is absent, not zero. A 0% bar is not a small
 *    amount of evidence, it is the absence of it, and rendering it as a row
 *    made the profile look more certain than it was.
 *  - The denominator is total *likes*, not total swipes. "You liked 3 of 8 food
 *    venues" is a different and much less flattering claim than "food is 50% of
 *    what you liked", and only the second one is a share.
 *
 * @param {Array<{category: string, likes: number, skips: number}>} tally
 * @param {{limit?: number}} [options]
 * @returns {Array<{category: string, label: string, likes: number, skips: number, percent: number}>}
 */
export function toInterestBars(tally, { limit = 4 } = {}) {
  const liked = asArray(tally).filter(
    (row) => row && Number(row.likes) > 0
  );

  const totalLikes = liked.reduce((sum, row) => sum + Number(row.likes), 0);

  if (totalLikes === 0) {
    return [];
  }

  return liked
    .map((row) => ({
      category: row.category,
      label: describeCategory(row.category),
      likes: Number(row.likes),
      skips: Number(row.skips) || 0,
      percent: Math.round((Number(row.likes) / totalLikes) * 100),
    }))
    .sort(
      (a, b) =>
        b.likes - a.likes ||
        a.label.localeCompare(b.label)
    )
    .slice(0, limit);
}

/**
 * The category a traveller's likes are concentrated in, or null when they have
 * none. Used to place the traveller relative to the rest of the crew and to
 * order their ideal day.
 */
export function topCategoryFromTally(tally) {
  return (
    toInterestBars(tally, { limit: 1 })[0]?.category ?? null
  );
}

/**
 * The evidence line under the style name.
 *
 * The reason count is a count of swipes that carried at least one reason, not
 * of individual reasons: it cannot exceed the swipe count, so the sentence it
 * appears in always means something. A count of chips could read "18 swipes and
 * 24 reasons" and quietly imply the traveller is less decisive than they were.
 *
 * The clause is dropped entirely when no swipe carried a reason rather than
 * rendered as a zero, because "0 with a reason" invites the reading that the
 * traveller declined to engage when in fact there was nothing to pick.
 */
export function toEvidenceLine({
  swipeCount = 0,
  reasonedSwipeCount = 0,
} = {}) {
  const swipes = Number(swipeCount) || 0;
  const reasoned = Number(reasonedSwipeCount) || 0;

  if (swipes === 0) {
    return "";
  }

  const swipesText = `${swipes} ${swipes === 1 ? "swipe" : "swipes"}`;

  if (reasoned <= 0) {
    return `Based on ${swipesText}`;
  }

  return `Based on ${swipesText}, ${reasoned} with a reason`;
}

/**
 * The reason chips a traveller reached for, most used first.
 *
 * These are the words the user actually tapped, so the ordering is decided here
 * rather than by the model -- an AI paraphrase of "Local favourite" and "Good
 * value" is not quotable as something the traveller chose.
 *
 * Expect empty arrays on generated trips: those cards ship with no chip
 * vocabulary (src/services/tripService.js deckRowToCard sets likeR/noR to []),
 * so only a typed note ever populates swipes.reasons.
 *
 * @param {{liked?: Array<{reason: string, count: number}>,
 *          skipped?: Array<{reason: string, count: number}>}} reasonTally
 * @param {{limit?: number}} [options]
 */
export function toReasonHighlights(reasonTally, { limit = 2 } = {}) {
  const source = asObject(reasonTally);
  const top = (rows) =>
    asArray(rows)
      .filter(
        (row) =>
          row && typeof row.reason === "string" && row.reason.trim()
      )
      .map((row) => ({
        reason: row.reason.trim(),
        count: Number(row.count) || 0,
      }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.reason.localeCompare(b.reason)
      )
      .slice(0, limit);

  return {
    liked: top(source.liked),
    skipped: top(source.skipped),
  };
}

/**
 * A three-stop shape for the day the profile implies.
 *
 * There is no time-of-day data on any card -- no "mornings", no opening hours,
 * only estimated_duration_min -- so a real breakfast/lunch/dinner split cannot
 * be built. What the categories do support is a meal / middle / meal shape, and
 * that is what this produces: food first, then the categories the traveller
 * actually likes ordered by share, then a second food stop if they liked more
 * than one. It is an ordering heuristic, not a schedule, and the UI should not
 * imply otherwise.
 *
 * @param {Array<{name: string, category: string}>} likedCards
 * @param {Array<{category: string, likes: number, skips: number}>} tally
 * @param {{limit?: number}} [options]
 */
export function toIdealDay(likedCards, tally, { limit = 3 } = {}) {
  const cards = asArray(likedCards).filter(
    (card) =>
      card &&
      typeof card.name === "string" &&
      card.name.trim()
  );

  if (cards.length === 0) {
    return [];
  }

  const order = toInterestBars(tally, { limit: CATEGORIES.length })
    .map((bar) => bar.category)
    .filter((category) => category !== "food");

  const rank = (card) => {
    const index = order.indexOf(card.category);
    return index === -1 ? order.length : index;
  };

  const food = cards.filter((card) => card.category === "food");
  const middle = cards
    .filter((card) => card.category !== "food")
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.name.localeCompare(b.name)
    );

  // Food last only when there is a second food card to spend it on, so a
  // one-food deck reads as market then walk rather than walk then market. A
  // traveller who liked no food at all gets no meal stops, so the guard is on
  // `food` and not on `middle` -- food[0] is undefined on a foodless deck.
  const day = food.length > 0
    ? [food[0], ...middle, ...food.slice(1)]
    : middle;

  return day
    .slice(0, limit)
    .map((card) => ({
      name: card.name.trim(),
      category: card.category,
      label: describeCategory(card.category),
    }));
}

// Keywords that identify what a free-text interest string is pointing at.
// First match wins, so the order carries meaning: "rooftop bar" resolves to
// nightlife rather than to the view, and "Nature & Relaxation" resolves to
// nature rather than to wellness.
const LEGACY_INTEREST_KEYWORDS = [
  ["food", ["food", "market", "street", "gastro", "dining", "restaurant", "cafe"]],
  ["nightlife", ["night", "rooftop bar", "bar", "cocktail", "club", "late"]],
  ["nature", ["nature", "view", "scenic", "park", "green", "outdoor", "hike", "beach", "garden", "rooftop"]],
  ["culture", ["culture", "museum", "art", "history", "heritage", "temple", "architecture"]],
  ["wellness", ["wellness", "spa", "yoga", "relax", "sauna", "hot spring"]],
  ["shopping", ["shop", "retail", "boutique", "bazaar", "mall"]],
];

/**
 * Map the agent's free-text `interests` array onto the category enum.
 *
 * This is a shim for a stored summary that predates the metadata hand-off: an
 * analysis written before the tally was threaded through sessionStorage carries
 * only prose, and that prose is the only thing left to draw bars from. Anything
 * run after that change uses the real tally instead, so this path is reached
 * only by a tab that was mid-analysis at the time.
 *
 * It is strictly worse than the tally -- it counts interest *mentions*, not
 * swipes, and cannot distinguish a strong preference from a passing one -- but
 * it is honest about the two things the old code got wrong: it never invents a
 * category the enum does not have ("Scenic Views" was not one of them, which is
 * why that bar sat at 0%), and it drops what it cannot place rather than
 * guessing.
 *
 * @param {string[]} interests
 * @returns {Array<{category: string, likes: number, skips: number}>}
 */
export function toLegacyTally(interests) {
  const counts = new Map();

  for (const interest of asArray(interests)) {
    if (typeof interest !== "string" || !interest.trim()) {
      continue;
    }

    const text = interest.toLowerCase();
    const match = LEGACY_INTEREST_KEYWORDS.find(([, keywords]) =>
      keywords.some((keyword) => text.includes(keyword))
    );

    if (!match) {
      continue;
    }

    counts.set(match[0], (counts.get(match[0]) || 0) + 1);
  }

  return [...counts.entries()].map(([category, likes]) => ({
    category,
    likes,
    skips: 0,
  }));
}

// Keywords that identify what a style label is drawn to. First match wins, so
// the order is meaningful -- "Slow-Morning Locavore" resolves to food because
// "locavore" is checked, and deliberately not to a rhythm category, because
// being an early riser is not a disagreement about where to go.
const CREW_CATEGORY_KEYWORDS = [  ["food", ["locavore", "food", "gastro", "market", "street", "eater", "diner"]],
  ["nightlife", ["night", "late", "after-dark", "rooftop bar"]],
  ["culture", ["culture", "museum", "art", "history", "collector", "curious"]],
  ["nature", ["nature", "hiker", "outdoor", "green", "walk", "trail"]],
  ["wellness", ["wellness", "spa", "yoga", "slow", "rest", "recharge"]],
  ["shopping", ["shopping", "market stall", "browse", "retail"]],
];

/**
 * The category a piece of style wording points at, or null when it points at
 * none.
 *
 * This reads a phrase, not behaviour, and is used in two places that both need
 * to know what a *name* is claiming rather than what the evidence is: the crew
 * card, so it can describe the shape of a disagreement rather than assert a
 * conflict that may not exist, and resolveStyleName below, so a generated
 * identity can be checked against the swipes behind it.
 */
export function inferCategoryFromLabel(label) {
  if (typeof label !== "string" || !label.trim()) {
    return null;
  }

  const text = label.toLowerCase();

  for (const [category, keywords] of CREW_CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return category;
    }
  }

  return null;
}

// Single-word forms for composing a fallback identity. The display labels carry
// an "&" and a second noun ("Nature & Outdoors"), which reads badly in a
// two-word title.
const SHORT_CATEGORY_NAMES = {
  food: "Food",
  culture: "Culture",
  nature: "Nature",
  shopping: "Shopping",
  nightlife: "Nightlife",
  wellness: "Wellness",
};

/**
 * Check a generated style name against the swipes it claims to summarise.
 *
 * The Preference Agent is told to name only categories the tally supports, and
 * mostly does. It does not always: a traveller who skipped every food venue can
 * still come back "Food-Led Adventurer", directly above bars that say the
 * opposite. A prompt constraint is worth having but cannot be relied on, so the
 * claim is verified here too and replaced when it fails.
 *
 * Three cases deliberately pass through untouched:
 *  - no tally at all, because there is nothing to check against
 *  - a name that claims no category, because "Value-Driven Explorer" is not
 *    making a claim this can falsify
 *  - a name whose category does have likes behind it
 *
 * @param {string} styleName
 * @param {Array<{category: string, likes: number, skips: number}>} tally
 * @param {{fallback?: string}} [options]
 */
export function resolveStyleName(
  styleName,
  tally,
  { fallback = "Curious Explorer" } = {}
) {
  const name = typeof styleName === "string" ? styleName.trim() : "";

  const top = topCategoryFromTally(tally);

  if (!name || !top) {
    return name || fallback;
  }

  const claimed = inferCategoryFromLabel(name);

  if (claimed === null) {
    return name;
  }

  const supported = asArray(tally).some(
    (row) => row && row.category === claimed && Number(row.likes) > 0
  );

  if (supported) {
    return name;
  }

  return `${SHORT_CATEGORY_NAMES[top] || "Curious"} Explorer`;
}

/**
 * Where this traveller sits relative to the crew.
 *
 * Returns null when there is nothing honest to say, which is the important
 * case: a hardcoded "you prefer nature, Ben prefers nightlife" line would be
 * wrong every time the traveller's actual top category was food or nightlife,
 * sitting directly under bars that say otherwise.
 *
 * `agrees` and `tradeoffs` are independently empty-able. A traveller who
 * matches nobody can still see who they differ from.
 *
 * @param {Array<{name: string, label: string}>} crew
 * @param {string|null} topCategory
 */
export function toGroupInsight(crew, topCategory = null) {
  if (!topCategory) {
    return null;
  }

  const members = asArray(crew)
    .map((member) => ({
      name: member?.name,
      category: inferCategoryFromLabel(member?.label),
    }))
    .filter(
      (member) =>
        typeof member.name === "string" &&
        member.category !== null
    );

  if (members.length === 0) {
    return null;
  }

  return {
    agrees: members.filter(
      (member) => member.category === topCategory
    ),
    tradeoffs: members.filter(
      (member) => member.category !== topCategory
    ),
    topCategory,
  };
}

// The words that mean "nothing was answered". Two sources produce them and
// neither is under our control: the preference form stored the first list, and
// the Preference Agent reaches for "unspecified" on its own when the evidence
// is thin. All of them read as an unfilled settings field to a user, so they are
// collapsed to one positive word before they are shown or handed to the
// itinerary generator.
const UNSET_VALUES = new Set([
  "no preference",
  "unspecified",
  "unknown",
  "not specified",
  "not sure",
  "no preference set",
  "n/a",
]);

const FLEXIBLE = "Flexible";

// The scalar fields on a stored preferences object. `dietary` is an array and
// `note` is free text, so neither goes through normalisePreferenceValue.
const SCALAR_PREFERENCE_FIELDS = ["rhythm", "density", "dining", "foodBudget"];

/**
 * Migrate a stored preferences object onto the current option vocabulary.
 *
 * Only fields that already hold a value are rewritten. An empty field has to
 * stay empty, because the form marks an option selected by equality and
 * normalising it would silently pre-select "Flexible" for a traveller who never
 * answered.
 *
 * Applying this on the way in rather than on the way out means the next save
 * persists the new word, so the migration is self-completing: a user who edits
 * their preferences once stops carrying the legacy string for good.
 */
export function normaliseStoredPreferences(preferences) {
  const source = asObject(preferences);
  const next = { ...source };

  for (const field of SCALAR_PREFERENCE_FIELDS) {
    // Truthiness, not statedPreferenceValue: a stored "No preference" is a
    // stored value that must migrate, not an absent answer. Empty stays empty.
    if (source[field]) {
      next[field] = normalisePreferenceValue(source[field]);
    }
  }

  return next;
}

/**
 * The traveller's own answer for a field, or null when they did not give one.
 *
 * Distinct from normalisePreferenceValue, which answers "what should the screen
 * show" and therefore always produces a word. This one answers "is there
 * anything here to prefer", which is what lets the identity card's chips fall
 * back to the agent's inference only where the traveller was actually silent.
 *
 * Without the distinction the screen renders the same field twice with two
 * different values -- "Budget · Flexible" in a chip and "Budget:
 * Value-focused" in the table -- because the chip was reading the agent's
 * inference while the table read the form the traveller filled in themselves.
 */
export function statedPreferenceValue(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();

  return UNSET_VALUES.has(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Normalise a preference value for display and for the generator's prompt.
 *
 * Applied to both sources, so the pace and budget chips on the identity card and
 * the rows of the preferences table cannot disagree about what "nothing was
 * said" looks like. An unset value becomes "Flexible" rather than being hidden,
 * because a hidden field reads as a gap and a stated one reads as a choice.
 */
export function normalisePreferenceValue(value) {
  if (typeof value !== "string" || !value.trim()) {
    return FLEXIBLE;
  }

  const trimmed = value.trim();

  return UNSET_VALUES.has(trimmed.toLowerCase()) ? FLEXIBLE : trimmed;
}

/**
 * Dietary restrictions, normalised.
 *
 * "None" is a real selectable option, not an empty state, so it arrives as
 * ["None"] and has to be distinguished from a traveller who answered nothing.
 * Both read as "No restrictions": one is an answer, the other is the absence of
 * a constraint, and neither should look like an unfilled field.
 */
export function normaliseDietary(dietary) {
  if (!Array.isArray(dietary) || dietary.length === 0) {
    return "No restrictions";
  }

  const answered = dietary
    .filter((item) => typeof item === "string" && item.trim())
    .filter((item) => item.trim() !== "None");

  if (answered.length === 0) {
    return "No restrictions";
  }

  return answered.join(", ");
}
