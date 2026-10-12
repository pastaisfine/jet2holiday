import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  describeCategory,
  toInterestBars,
  topCategoryFromTally,
  toEvidenceLine,
  toIdealDay,
  toLegacyTally,
  inferCategoryFromLabel,
  resolveStyleName,
  toGroupInsight,
  statedPreferenceValue,
  normalisePreferenceValue,
  normaliseStoredPreferences,
  normaliseDietary,
} from "./preferenceProfile";

// The tally shape the Preference Agent returns in metadata
// (supabase/functions/preference), already filtered to rows with at least one
// swipe in the category.
const tally = (...rows) => rows;

describe("describeCategory", () => {
  it("labels every category in the enum", () => {
    for (const category of CATEGORIES) {
      expect(describeCategory(category)).not.toBe("Other");
    }
  });

  it("falls back for a category outside the enum", () => {
    expect(describeCategory("shopping-mall")).toBe("Other");
  });
});

describe("toInterestBars", () => {
  it("does not render a bar for a category with no likes", () => {
    const bars = toInterestBars(
      tally(
        { category: "food", likes: 3, skips: 1 },
        { category: "nightlife", likes: 0, skips: 4 }
      )
    );

    expect(bars.map((bar) => bar.category)).toEqual(["food"]);
  });

  it("returns nothing when every category was only skipped", () => {
    expect(
      toInterestBars(
        tally({ category: "nightlife", likes: 0, skips: 6 })
      )
    ).toEqual([]);
  });

  it("returns nothing for an empty or missing tally", () => {
    expect(toInterestBars([])).toEqual([]);
    expect(toInterestBars()).toEqual([]);
  });

  it("expresses each bar as a share of likes, not of swipes", () => {
    // The distinction that matters: 3 of 4 food venues liked, alongside 1 of 4
    // culture venues, is 75/25 of what was liked -- not 75/25 of what was seen,
    // which would be a different and much less flattering pair of numbers.
    const bars = toInterestBars(
      tally(
        { category: "food", likes: 3, skips: 1 },
        { category: "culture", likes: 1, skips: 3 }
      )
    );

    expect(bars).toEqual([
      {
        category: "food",
        label: "Food & Markets",
        likes: 3,
        skips: 1,
        percent: 75,
      },
      {
        category: "culture",
        label: "Arts & Culture",
        likes: 1,
        skips: 3,
        percent: 25,
      },
    ]);
  });

  it("never shows a zero-percent bar", () => {
    const bars = toInterestBars(
      tally(
        { category: "food", likes: 5, skips: 0 },
        { category: "nature", likes: 0, skips: 2 },
        { category: "culture", likes: 0, skips: 9 },
        { category: "wellness", likes: 0, skips: 1 },
        { category: "shopping", likes: 0, skips: 1 }
      )
    );

    expect(bars).toHaveLength(1);
    expect(bars[0].percent).toBeGreaterThan(0);
  });

  it("keeps the displayed shares summing to 100 despite rounding", () => {
    const bars = toInterestBars(
      tally(
        { category: "food", likes: 1, skips: 0 },
        { category: "nature", likes: 1, skips: 0 },
        { category: "culture", likes: 1, skips: 0 }
      )
    );

    const sum = bars.reduce((total, bar) => total + bar.percent, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(1);
  });

  it("gives a single liked category the whole share", () => {
    const bars = toInterestBars(
      tally({ category: "nature", likes: 1, skips: 7 })
    );

    expect(bars[0].percent).toBe(100);
  });

  it("caps the number of bars", () => {
    const many = CATEGORIES.map((category, index) => ({
      category,
      likes: CATEGORIES.length - index,
      skips: 0,
    }));

    expect(toInterestBars(many)).toHaveLength(4);
    expect(toInterestBars(many, { limit: 2 })).toHaveLength(2);
  });

  it("orders by likes, breaking ties by label so the row order is stable", () => {
    const bars = toInterestBars(
      tally(
        { category: "nightlife", likes: 2, skips: 0 },
        { category: "food", likes: 2, skips: 0 },
        { category: "nature", likes: 5, skips: 0 }
      )
    );

    expect(bars.map((bar) => bar.category)).toEqual([
      "nature",
      "food",
      "nightlife",
    ]);
  });

  it("ignores malformed rows rather than rendering NaN", () => {
    const bars = toInterestBars(
      tally(null, undefined, { category: "food", likes: 2, skips: 0 })
    );

    expect(bars).toHaveLength(1);
    expect(bars[0].percent).toBe(100);
  });
});

describe("topCategoryFromTally", () => {
  it("returns the most-liked category", () => {
    expect(
      topCategoryFromTally(
        tally(
          { category: "food", likes: 1, skips: 2 },
          { category: "culture", likes: 4, skips: 0 }
        )
      )
    ).toBe("culture");
  });

  it("returns null when nothing was liked", () => {
    expect(topCategoryFromTally([])).toBe(null);
    expect(
      topCategoryFromTally(tally({ category: "food", likes: 0, skips: 3 }))
    ).toBe(null);
  });
});

describe("toEvidenceLine", () => {
  it("says nothing when there were no swipes", () => {
    expect(toEvidenceLine({})).toBe("");
    expect(toEvidenceLine({ swipeCount: 0 })).toBe("");
  });

  it("uses the singular for one swipe", () => {
    expect(toEvidenceLine({ swipeCount: 1 })).toBe("Based on 1 swipe");
  });

  it("counts swipes, not individual cards", () => {
    expect(toEvidenceLine({ swipeCount: 18 })).toBe("Based on 18 swipes");
  });

  it("tolerates a missing or non-numeric count", () => {
    expect(toEvidenceLine({ swipeCount: null })).toBe("");
    expect(toEvidenceLine({ swipeCount: "many" })).toBe("");
  });
});

describe("toIdealDay", () => {
  const cards = [
    { name: "Time Out Market", category: "food" },
    { name: "Miradouro", category: "nature" },
    { name: "Museu Nacional", category: "culture" },
    { name: "Time Out second stop", category: "food" },
  ];

  const share = tally(
    { category: "food", likes: 4, skips: 0 },
    { category: "culture", likes: 3, skips: 0 },
    { category: "nature", likes: 1, skips: 0 }
  );

  it("opens on food and closes on food when there is a second one", () => {
    expect(
      toIdealDay(cards, share).map((stop) => stop.name)
    ).toEqual([
      "Time Out Market",
      "Museu Nacional",
      "Miradouro",
    ]);
  });

  it("orders the middle by how much the traveller likes each category", () => {
    const day = toIdealDay(cards, share).map((stop) => stop.name);
    expect(day.indexOf("Museu Nacional")).toBeLessThan(
      day.indexOf("Miradouro")
    );
  });

  it("does not invent a closing food stop from a single food card", () => {
    const day = toIdealDay(
      [
        { name: "Miradouro", category: "nature" },
        { name: "Museu Nacional", category: "culture" },
        { name: "Time Out Market", category: "food" },
      ],
      share
    ).map((stop) => stop.name);

    expect(day[0]).toBe("Time Out Market");
  });

  it("puts food first when food is the only thing liked", () => {
    const foodOnlyCards = [
      { name: "Time Out Market", category: "food" },
      { name: "Time Out second stop", category: "food" },
    ];
    const foodOnly = tally({ category: "food", likes: 2, skips: 0 });

    expect(
      toIdealDay(foodOnlyCards, foodOnly).map((stop) => stop.name)
    ).toEqual(["Time Out Market", "Time Out second stop"]);
  });

  it("reads a foodless deck as its middle alone", () => {
    // No food card was liked, so there is no meal to place at either end. The
    // old guard keyed off `middle` here and put an undefined in the day, which
    // threw on the name it went looking for.
    const foodless = [
      { name: "Miradouro", category: "nature" },
      { name: "Museu Nacional", category: "culture" },
    ];
    const foodlessTally = tally(
      { category: "culture", likes: 3, skips: 0 },
      { category: "nature", likes: 2, skips: 0 }
    );

    expect(
      toIdealDay(foodless, foodlessTally).map((stop) => stop.name)
    ).toEqual(["Museu Nacional", "Miradouro"]);
  });

  it("leaves a category out of the middle when the tally has no likes for it", () => {
    // likedCards and the tally are two views of the same evidence. When they
    // disagree the cards win, because a card the user liked is liked whatever
    // the summary says -- but the summary still decides the ordering.
    const day = toIdealDay(cards, share).map((stop) => stop.name);
    expect(day).toHaveLength(3);
    expect(day).toContain("Time Out Market");
  });

  it("caps the number of stops", () => {
    const many = [
      { name: "A", category: "food" },
      { name: "B", category: "nature" },
      { name: "C", category: "culture" },
      { name: "D", category: "shopping" },
      { name: "E", category: "food" },
    ];

    expect(toIdealDay(many, share)).toHaveLength(3);
    expect(toIdealDay(many, share, { limit: 5 })).toHaveLength(5);
  });

  it("returns nothing when the traveller liked nothing", () => {
    expect(toIdealDay([], share)).toEqual([]);
    expect(toIdealDay()).toEqual([]);
  });

  it("skips cards with no usable name", () => {
    expect(
      toIdealDay([{ category: "food" }, { name: "  " }], share)
    ).toEqual([]);
  });
});

// Keywords that identify what a style label is drawn to. First match wins, so
// the order carries meaning: "rooftop bar" resolves to nightlife rather than to
// the view, and "Nature & Relaxation" resolves to nature rather than to
// wellness.
describe("toLegacyTally", () => {
  it("reproduces the contradiction-free version of the old screen", () => {
    // The exact input that produced "Value-Driven Nature Explorer" above a
    // "Scenic Views 0%" bar. Under the old five fixed buckets this rendered
    // 50/0/0/50/0 -- four of the five rows had no evidence behind them, and one
    // of them was a category the system does not have.
    const bars = toInterestBars(
      toLegacyTally(["Food & Markets", "Nature & Relaxation"])
    );

    expect(bars.map((bar) => bar.label)).toEqual([
      "Food & Markets",
      "Nature & Outdoors",
    ]);
    expect(bars.every((bar) => bar.percent > 0)).toBe(true);
  });

  it("folds scenic views into the nature category that actually exists", () => {
    const tally = toLegacyTally(["Scenic Views"]);

    expect(tally).toEqual([{ category: "nature", likes: 1, skips: 0 }]);
  });

  it("resolves a rooftop bar to nightlife, not to the view", () => {
    expect(toLegacyTally(["Rooftop bars"])).toEqual([
      { category: "nightlife", likes: 1, skips: 0 },
    ]);
  });

  it("drops an interest it cannot place rather than guessing", () => {
    const tally = toLegacyTally([
      "An inexplicable interest",
      "Food",
    ]);

    expect(tally).toEqual([{ category: "food", likes: 1, skips: 0 }]);
  });

  it("counts repeats toward one category", () => {
    expect(toLegacyTally(["Food markets", "Street food", "Cafes"])).toEqual([
      { category: "food", likes: 3, skips: 0 },
    ]);
  });

  it("handles missing or malformed input", () => {
    expect(toLegacyTally()).toEqual([]);
    expect(toLegacyTally(["", "   ", null, 7])).toEqual([]);
  });
});

describe("inferCategoryFromLabel", () => {
  it("reads the crew labels the screen ships with", () => {
    expect(inferCategoryFromLabel("Slow-Morning Locavore")).toBe("food");
    expect(inferCategoryFromLabel("Curious Culture Collector")).toBe(
      "culture"
    );
    expect(inferCategoryFromLabel("Night-Optimist")).toBe("nightlife");
  });

  it("treats a slow start as a rhythm, not a competing interest", () => {
    // "Slow-Morning" must not resolve to wellness or nature, or a member who
    // simply gets up late would be reported as disagreeing about the day.
    expect(inferCategoryFromLabel("Slow-Morning Locavore")).not.toBe(
      "nature"
    );
  });

  it("returns null for a label that points nowhere", () => {
    expect(inferCategoryFromLabel("Night-Optimist".slice(0, 0) + "Zzz")).toBe(
      null
    );
    expect(inferCategoryFromLabel("")).toBe(null);
    expect(inferCategoryFromLabel(null)).toBe(null);
  });
});

describe("resolveStyleName", () => {
  const foodOnly = tally({ category: "food", likes: 5, skips: 2 });

  it("keeps a name the evidence supports", () => {
    expect(
      resolveStyleName("Food-Led Adventurer", foodOnly)
    ).toBe("Food-Led Adventurer");
  });

  it("replaces a name claiming a category nothing was liked in", () => {
    // The contradiction the screen exists to prevent: an identity built on
    // nightlife above bars that never once show a nightlife like.
    expect(resolveStyleName("Night-Optimist", foodOnly)).toBe(
      "Food Explorer"
    );
    expect(resolveStyleName("Nightlife Nomad", foodOnly)).toBe(
      "Food Explorer"
    );
  });

  it("bases the replacement on the most-liked category", () => {
    const natureLed = [
      { category: "nature", likes: 4, skips: 0 },
      { category: "culture", likes: 1, skips: 0 },
    ];

    expect(resolveStyleName("Food-Led Adventurer", natureLed)).toBe(
      "Nature Explorer"
    );
  });

  it("leaves a name that claims no category alone", () => {
    // "Value-Driven Explorer" asserts no falsifiable category, so there is
    // nothing here to contradict.
    expect(resolveStyleName("Value-Driven Explorer", foodOnly)).toBe(
      "Value-Driven Explorer"
    );
  });

  it("has nothing to check against with no tally", () => {
    expect(resolveStyleName("Night-Optimist", [])).toBe(
      "Night-Optimist"
    );
  });

  it("falls back when there is no name at all", () => {
    expect(resolveStyleName("", foodOnly)).toBe("Curious Explorer");
    expect(resolveStyleName(undefined, foodOnly)).toBe(
      "Curious Explorer"
    );
  });

  it("cannot produce a claim it would then reject", () => {
    // The replacement is itself category-bearing, so a second pass over it must
    // pass -- otherwise the guard would oscillate on every render.
    const once = resolveStyleName("Night-Optimist", foodOnly);
    expect(resolveStyleName(once, foodOnly)).toBe(once);
  });
});

describe("toGroupInsight", () => {
  const crew = [
    { name: "Ben", label: "Slow-Morning Locavore" },
    { name: "Priya", label: "Curious Culture Collector" },
    { name: "Marcus", label: "Night-Optimist" },
  ];

  it("says nothing when the traveller has liked nothing yet", () => {
    expect(toGroupInsight(crew, null)).toBe(null);
  });

  it("says nothing when no crew label is readable", () => {
    expect(toGroupInsight([{ name: "Ben", label: "???" }], "food")).toBe(
      null
    );
  });

  it("separates agreement from trade-off", () => {
    const insight = toGroupInsight(crew, "food");

    expect(insight.agrees.map((m) => m.name)).toEqual(["Ben"]);
    expect(insight.tradeoffs.map((m) => m.name)).toEqual([
      "Priya",
      "Marcus",
    ]);
  });

  it("reports no trade-off when everyone matches", () => {
    const insight = toGroupInsight(
      [
        { name: "Ben", label: "Slow-Morning Locavore" },
        { name: "Priya", label: "Market Foodie" },
      ],
      "food"
    );

    expect(insight.agrees).toHaveLength(2);
    expect(insight.tradeoffs).toEqual([]);
  });

  it("reports no agreement when the traveller matches nobody", () => {
    const insight = toGroupInsight(crew, "wellness");

    expect(insight.agrees).toEqual([]);
    expect(insight.tradeoffs).toHaveLength(3);
  });
});

describe("statedPreferenceValue", () => {
  it("returns what the traveller actually chose", () => {
    expect(statedPreferenceValue("Value-focused")).toBe(
      "Value-focused"
    );
  });

  it("returns null when nothing was answered, however it was phrased", () => {
    // This is the distinction that lets the chips fall back to the agent's
    // inference: normalisePreferenceValue would hand back "Flexible" for all of
    // these, which is not evidence that the traveller said anything.
    for (const value of [
      "",
      "   ",
      undefined,
      null,
      "No preference",
      "unspecified",
      "Unknown",
      "n/a",
    ]) {
      expect(statedPreferenceValue(value)).toBe(null);
    }
  });
});

describe("normalisePreferenceValue", () => {
  it("rewrites the legacy unset word to Flexible", () => {
    expect(normalisePreferenceValue("No preference")).toBe("Flexible");
  });

  it("rewrites the agent's own unset words too", () => {
    // The Preference Agent returns "unspecified" on its own when the evidence
    // is thin, which is the same gap the user is looking at.
    for (const value of [
      "unspecified",
      "Unspecified",
      "unknown",
      "Not specified",
      "n/a",
    ]) {
      expect(normalisePreferenceValue(value)).toBe("Flexible");
    }
  });

  it("treats an unanswered field as Flexible", () => {
    expect(normalisePreferenceValue("")).toBe("Flexible");
    expect(normalisePreferenceValue("   ")).toBe("Flexible");
    expect(normalisePreferenceValue(undefined)).toBe("Flexible");
    expect(normalisePreferenceValue(null)).toBe("Flexible");
  });

  it("leaves a real answer alone, including one containing 'no'", () => {
    expect(normalisePreferenceValue("Value-focused")).toBe(
      "Value-focused"
    );
    expect(normalisePreferenceValue("Moderate")).toBe("Moderate");
    expect(normalisePreferenceValue("No fine dining")).toBe(
      "No fine dining"
    );
  });
});

// Supabase spells "absent" as null: an unwritten JSONB column and a null
// category on a user-added place both come back null, not undefined. A default
// parameter covers only undefined, so every entry point is called with null here
// as well as with nothing at all. Getting this wrong blanks the whole profile
// for exactly the users with the least data on them.
describe("null tolerance", () => {
  it("reads an absent tally as no evidence", () => {
    expect(toInterestBars(null)).toEqual([]);
    expect(topCategoryFromTally(null)).toBe(null);
    expect(toLegacyTally(null)).toEqual([]);
    expect(toGroupInsight(null, "food")).toBe(null);
    expect(toIdealDay(null, null)).toEqual([]);
    expect(resolveStyleName("Night-Optimist", null)).toBe(
      "Night-Optimist"
    );
  });

  it("reads absent preferences as unset", () => {
    expect(normaliseStoredPreferences(null)).toEqual({});
    expect(normaliseDietary(null)).toBe("No restrictions");
  });

  it("tolerates null rows inside a tally", () => {
    expect(
      toInterestBars([null, { category: "food", likes: 2, skips: 0 }])
    ).toHaveLength(1);
  });
});

describe("normaliseStoredPreferences", () => {
  it("migrates every scalar field off the legacy word", () => {
    expect(
      normaliseStoredPreferences({
        rhythm: "No preference",
        density: "No preference",
        dining: "No preference",
        foodBudget: "No preference",
      })
    ).toEqual({
      rhythm: "Flexible",
      density: "Flexible",
      dining: "Flexible",
      foodBudget: "Flexible",
    });
  });

  it("leaves an unanswered field unanswered", () => {
    // The form marks an option selected by equality, so normalising an empty
    // field would silently pre-select "Flexible" for someone who never chose.
    expect(normaliseStoredPreferences({ rhythm: "" }).rhythm).toBe("");
  });

  it("keeps real answers, dietary and notes untouched", () => {
    const preferences = {
      rhythm: "Early start",
      dietary: ["Vegan"],
      note: "Nut allergy",
    };

    expect(normaliseStoredPreferences(preferences)).toEqual(preferences);
  });

  it("tolerates a missing object", () => {
    expect(normaliseStoredPreferences()).toEqual({});
    expect(normaliseStoredPreferences(null)).toEqual({});
  });
});

describe("normaliseDietary", () => {
  it("reads an explicit None as no restrictions", () => {
    expect(normaliseDietary(["None"])).toBe("No restrictions");
  });

  it("reads an unanswered field as no restrictions", () => {
    expect(normaliseDietary([])).toBe("No restrictions");
    expect(normaliseDietary(undefined)).toBe("No restrictions");
  });

  it("lists real restrictions", () => {
    expect(normaliseDietary(["Vegan", "Nut allergy"])).toBe(
      "Vegan, Nut allergy"
    );
  });

  it("ignores a stray None alongside real restrictions", () => {
    expect(normaliseDietary(["None", "Gluten-free"])).toBe(
      "Gluten-free"
    );
  });
});
