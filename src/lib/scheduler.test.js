import { describe, it, expect } from "vitest";
import {
  scheduleDay,
  stopDurationMinutes,
  formatClock,
  parseClock,
  haversineMeters,
  formatLeg,
} from "./scheduler";

const stop = (overrides = {}) => ({
  id: "s1",
  name: "Place",
  category: "culture",
  estimatedDuration: 60,
  lat: 3.1578,
  lng: 101.7116,
  ...overrides,
});

describe("parseClock / formatClock", () => {
  it("round-trips a time of day", () => {
    expect(parseClock("09:00")).toBe(540);
    expect(formatClock(540)).toBe("09:00");
    expect(formatClock(14 * 60 + 5)).toBe("14:05");
  });

  it("rejects malformed clocks", () => {
    expect(parseClock("9am")).toBeNull();
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock(null)).toBeNull();
  });
});

describe("stopDurationMinutes", () => {
  it("uses the recorded duration when the discovery pipeline has one", () => {
    expect(stopDurationMinutes(stop({ estimatedDuration: 120 }))).toBe(120);
  });

  it("falls back to a category default when the duration is missing", () => {
    expect(stopDurationMinutes(stop({ category: "food", estimatedDuration: null }))).toBe(60);
    expect(stopDurationMinutes(stop({ category: "culture", estimatedDuration: 0 }))).toBe(90);
  });

  it("clamps absurd values to a usable window", () => {
    expect(stopDurationMinutes(stop({ estimatedDuration: 5 }))).toBe(20);
    expect(stopDurationMinutes(stop({ estimatedDuration: 600 }))).toBe(180);
  });
});

describe("scheduleDay", () => {
  it("runs stops back-to-back, adding travel between them", () => {
    const result = scheduleDay({
      stops: [stop({ id: "a", estimatedDuration: 60 }), stop({ id: "b", estimatedDuration: 30 })],
      legs: [{ distanceMeters: 800, durationSec: 600 }],
    });

    expect(result.stops[0].t).toBe("09:00");
    expect(result.stops[0].end).toBe("10:00");
    // 10 minutes of travel after stop A.
    expect(result.stops[1].t).toBe("10:10");
    expect(result.stops[1].end).toBe("10:40");
    expect(result.travelMinutes).toBe(10);
    expect(result.overflow).toBe(false);
  });

  it("attaches the outgoing leg to the stop it departs from", () => {
    const result = scheduleDay({
      stops: [stop({ id: "a" }), stop({ id: "b" }), stop({ id: "c" })],
      legs: [
        { distanceMeters: 800, durationSec: 600 },
        { distanceMeters: 400, durationSec: 300 },
      ],
    });

    // The plan card renders the leg beneath the stop it leaves from, so the
    // first stop must carry the first leg and the last must carry none.
    expect(result.stops[0].leg.distanceMeters).toBe(800);
    expect(result.stops[1].leg.distanceMeters).toBe(400);
    expect(result.stops[2].leg).toBeNull();
  });

  it("estimates a leg from straight-line distance when routing is missing", () => {
    const result = scheduleDay({
      stops: [
        stop({ id: "a", lat: 3.1578, lng: 101.7116 }),
        stop({ id: "b", lat: 3.1374, lng: 101.6861 }),
      ],
      legs: [],
    });

    expect(result.stops[0].leg.estimated).toBe(true);
    expect(result.stops[0].leg.durationMin).toBeGreaterThan(0);
  });

  it("flags a day that spills past its close instead of dropping stops", () => {
    const heavy = Array.from({ length: 6 }, (_, i) =>
      stop({ id: `s${i}`, estimatedDuration: 180 }),
    );
    const result = scheduleDay({ stops: heavy, legs: [] });

    expect(result.stops).toHaveLength(6);
    expect(result.overflow).toBe(true);
    expect(result.stops.some((s) => s.late)).toBe(true);
  });

  it("starts later and stretches stops on a relaxed pace", () => {
    const balanced = scheduleDay({ stops: [stop({ estimatedDuration: 60 })], legs: [] });
    const relaxed = scheduleDay({ stops: [stop({ estimatedDuration: 60 })], legs: [], pace: "relaxed" });

    expect(relaxed.startTime).toBe("10:00");
    expect(parseClock(relaxed.stops[0].t)).toBeGreaterThan(parseClock(balanced.stops[0].t));
    expect(relaxed.stops[0].durationMin).toBeGreaterThan(balanced.stops[0].durationMin);
  });

  it("marks a food stop landing at midday as lunch", () => {
    const result = scheduleDay({
      stops: [
        stop({ id: "a", estimatedDuration: 120 }),
        stop({ id: "lunch", category: "food", estimatedDuration: 60 }),
      ],
      legs: [],
    });

    expect(result.stops[1].t).toBe("11:00");
    expect(result.stops[1].lunch).toBe(true);
  });

  it("returns an empty schedule for a day with no stops", () => {
    const result = scheduleDay({ stops: [] });
    expect(result.stops).toEqual([]);
    expect(result.totalMinutes).toBe(0);
  });
});

describe("haversineMeters", () => {
  it("measures a known distance", () => {
    // Petronas Towers → KLCC Park is roughly 600-700 m.
    const distance = haversineMeters(
      { lat: 3.1578, lng: 101.7116 },
      { lat: 3.1545, lng: 101.7152 },
    );
    expect(distance).toBeGreaterThan(400);
    expect(distance).toBeLessThan(800);
  });

  it("returns 0 for missing coordinates rather than NaN", () => {
    expect(haversineMeters({ lat: 1, lng: 1 }, {})).toBe(0);
  });
});

describe("formatLeg", () => {
  it("formats metres and minutes for the plan screen", () => {
    expect(formatLeg({ distanceMeters: 669, durationMin: 9 })).toBe("669m · 9min");
    expect(formatLeg({ distanceMeters: 1200, durationMin: 15 })).toBe("1.2 km · 15min");
  });

  it("returns null for a zero-distance leg", () => {
    expect(formatLeg({ distanceMeters: 0, durationMin: 0 })).toBeNull();
    expect(formatLeg(null)).toBeNull();
  });
});
