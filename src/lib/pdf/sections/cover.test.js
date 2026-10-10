import { describe, it, expect } from "vitest";
import { coverDates, crewNames, shortDestination } from "./cover.js";
import { hasStory } from "./story.js";

const TRIP = { start_date: "2026-06-05", end_date: "2026-06-12" };

describe("coverDates", () => {
  it("collapses a same-month range", () => {
    expect(coverDates(TRIP)).toBe("June 5 – 12, 2026");
  });

  it("names both months across one", () => {
    expect(coverDates({ start_date: "2026-06-28", end_date: "2026-07-04" })).toBe(
      "June 28 – July 4, 2026",
    );
  });

  it("handles a single day", () => {
    expect(coverDates({ start_date: "2026-06-05", end_date: "2026-06-05" })).toBe(
      "June 5 – 5, 2026",
    );
  });

  it("falls back to the start when there is no end", () => {
    expect(coverDates({ start_date: "2026-06-05" })).toBe("June 5, 2026");
  });

  it("falls back to the day count when the trip has no dates", () => {
    expect(coverDates({ dayCount: 5 })).toBe("5 days");
    expect(coverDates({ dayCount: 1 })).toBe("1 day");
  });

  it("gives nothing at all rather than a blank line", () => {
    expect(coverDates({})).toBe("");
    expect(coverDates(null)).toBe("");
  });
});

describe("crewNames", () => {
  it("lists everyone once, in join order", () => {
    expect(crewNames([{ username: "ana" }, { username: "ben" }, { username: "ana" }])).toEqual([
      "ana",
      "ben",
    ]);
  });

  it("reads username, which is what membership rows actually carry", () => {
    expect(crewNames([{ userId: "1", username: "ana", avatarColor: "#fff" }])).toEqual(["ana"]);
  });

  it("falls back to the richer profile shapes when there is no username", () => {
    expect(crewNames([{ displayName: "Ana" }, { name: "Ben" }])).toEqual(["Ana", "Ben"]);
  });

  it("drops blank and missing names", () => {
    expect(crewNames([{ username: "  " }, {}, null, { username: "ana" }])).toEqual(["ana"]);
    expect(crewNames([])).toEqual([]);
    expect(crewNames(null)).toEqual([]);
  });
});

describe("shortDestination", () => {
  it("keeps the city and drops the region", () => {
    expect(shortDestination("Paris, France")).toBe("Paris");
  });

  it("copes with a bare destination or nothing at all", () => {
    expect(shortDestination("Lisbon")).toBe("Lisbon");
    expect(shortDestination("")).toBe("Your trip");
    expect(shortDestination(null)).toBe("Your trip");
  });
});

describe("hasStory", () => {
  it("is true when the group agreed on something", () => {
    expect(hasStory({ group_priorities: ["Slow mornings"] }, null)).toBe(true);
  });

  it("is true when there is a summary or a conflict", () => {
    expect(hasStory(null, { summary: ["Built around early starts"] })).toBe(true);
    expect(hasStory({ group_conflicts: [{ topic: "Beach" }] }, null)).toBe(true);
    expect(hasStory({ hard_constraints: ["No red-eye flights"] }, null)).toBe(true);
    expect(hasStory({ recommended_balance: { food: "high" } }, null)).toBe(true);
  });

  it("is false for a group with nothing to say, so no blank page is printed", () => {
    expect(hasStory(null, null)).toBe(false);
    expect(hasStory({}, {})).toBe(false);
    expect(hasStory({ group_priorities: [], group_conflicts: [] }, { summary: [] })).toBe(false);
    expect(hasStory({ recommended_balance: {} }, null)).toBe(false);
  });

  it("tolerates nulls where arrays were expected", () => {
    expect(hasStory({ group_priorities: null, group_conflicts: null }, null)).toBe(false);
  });
});