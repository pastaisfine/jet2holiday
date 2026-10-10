import { describe, it, expect } from "vitest";
import { coordinates, legLabel, stopMeta, timeRange } from "./stop.js";

const STOP = {
  name: "Louvre",
  category: "culture",
  area: "Le Marais",
  rating: 4.6,
  lat: 48.8606,
  lng: 2.3376,
  t: "09:00",
  end: "10:30",
};

describe("timeRange", () => {
  it("gives a range when the scheduler supplied both ends", () => {
    expect(timeRange(STOP)).toBe("09:00 – 10:30");
  });

  it("falls back to the start alone when there is no end", () => {
    expect(timeRange({ t: "09:00" })).toBe("09:00");
  });

  it("gives nothing for a stop with no time at all", () => {
    expect(timeRange({})).toBe("");
    expect(timeRange(null)).toBe("");
  });
});

describe("stopMeta", () => {
  it("joins category, rating and area", () => {
    expect(stopMeta(STOP)).toBe("Arts & Culture  ·  ★ 4.6  ·  Le Marais");
  });

  it("drops missing parts instead of leaving dangling separators", () => {
    expect(stopMeta({ category: "food" })).toBe("Food & Markets");
    expect(stopMeta({ area: "Le Marais" })).toBe("Le Marais");
    expect(stopMeta({})).toBe("");
    expect(stopMeta(null)).toBe("");
  });

  it("ignores a zero or absent rating rather than printing a star for it", () => {
    expect(stopMeta({ category: "food", rating: 0 })).toBe("Food & Markets");
    expect(stopMeta({ category: "food", rating: null })).toBe("Food & Markets");
  });

  it("falls back for a category outside the enum", () => {
    expect(stopMeta({ category: "skiing" })).toBe("Attractions");
  });
});

describe("coordinates", () => {
  it("formats to five decimals, about a few centimetres", () => {
    expect(coordinates(STOP)).toBe("48.86060, 2.33760");
  });

  it("gives nothing when a coordinate is missing, which suggestions can cause", () => {
    expect(coordinates({ lat: 48.86 })).toBe("");
    expect(coordinates({ lng: 2.33 })).toBe("");
    expect(coordinates({ lat: null, lng: null })).toBe("");
    expect(coordinates(null)).toBe("");
  });
});

describe("legLabel", () => {
  it("gives distance and time", () => {
    expect(legLabel({ distanceMeters: 1200, durationMin: 15 })).toBe("1.2 km · 15 min");
  });

  it("uses metres below a kilometre", () => {
    expect(legLabel({ distanceMeters: 669, durationMin: 9 })).toBe("669 m · 9 min");
  });

  it("gives distance alone when the duration is unknown", () => {
    expect(legLabel({ distanceMeters: 400, durationMin: 0 })).toBe("400 m");
  });

  it("gives nothing when the two stops are effectively the same place", () => {
    expect(legLabel({ distanceMeters: 0, durationMin: 0 })).toBe("");
    expect(legLabel(null)).toBe("");
  });
});