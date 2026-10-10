import { describe, it, expect } from "vitest";
import { dayHeading, daySubtitle } from "./day.js";

describe("dayHeading", () => {
  it("formats the date the way the plan screen does", () => {
    // 2026-06-05 was a Friday; the stored value is a calendar day, not an
    // instant, so parseTripDate keeps it local.
    expect(dayHeading({ day_index: 0, date: "2026-06-05" })).toBe("06.05 Fri");
  });

  it("falls back to the ordinal when the day has no date", () => {
    expect(dayHeading({ day_index: 2 })).toBe("Day 3");
    expect(dayHeading({ day_index: 0 })).toBe("Day 1");
    expect(dayHeading({})).toBe("Day 1");
    expect(dayHeading(null)).toBe("Day 1");
  });
});

describe("daySubtitle", () => {
  it("gives the window and the mode", () => {
    expect(
      daySubtitle({ startTime: "09:00", endTime: "19:00", transport_mode: "walking" }),
    ).toBe("09:00 – 19:00   ·   On foot");
  });

  it("labels driving", () => {
    expect(daySubtitle({ startTime: "09:00", endTime: "18:00", transport_mode: "driving" })).toContain(
      "By car",
    );
  });

  it("marks a day that runs past its close", () => {
    expect(daySubtitle({ startTime: "09:00", endTime: "21:30", overflow: true })).toContain(
      "Runs late",
    );
  });

  it("tolerates a half-known window", () => {
    expect(daySubtitle({ startTime: "09:00" })).toBe("09:00");
    expect(daySubtitle({ endTime: "19:00" })).toBe("? – 19:00");
  });

  it("gives nothing for a day with no times and no mode", () => {
    expect(daySubtitle({})).toBe("");
    expect(daySubtitle(null)).toBe("");
  });
});