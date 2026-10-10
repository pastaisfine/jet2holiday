import { describe, it, expect } from "vitest";
import { collectAssets, groupPhotosByDay, pdfFilename } from "./index.js";

const DAY = {
  day_index: 0,
  date: "2026-06-05",
  title: "Classical Paris",
  transport_mode: "walking",
  startTime: "09:00",
  endTime: "19:00",
  stops: [
    {
      name: "Louvre Museum",
      category: "culture",
      area: "Rue de Rivoli",
      rating: 4.7,
      description: "The Mona Lisa is a small part of it, and that is fine.",
      img: "https://example.test/a.jpg",
      lat: 48.8606,
      lng: 2.3376,
      t: "09:00",
      end: "11:00",
    },
    { name: "No photo, no coords", category: "food", t: "12:30", end: "13:30" },
    { name: "Le Comptoir", category: "food", img: "https://example.test/b.jpg", t: "19:00", end: "21:00" },
  ],
};

const PLAN = {
  validated_plan: { days: [DAY] },
};

describe("collectAssets", () => {
  it("finds every photo in order, with the slot it belongs to", () => {
    const assets = collectAssets({ plan: PLAN, trip: { destination: "Paris, France" } });
    expect(assets.photoUrls).toEqual(["https://example.test/a.jpg", "https://example.test/b.jpg"]);
    expect(assets.photoSlots.map((s) => s.index)).toEqual([0, 2]);
  });

  it("produces nothing rather than throwing for an unbuilt plan", () => {
    const assets = collectAssets({ plan: null, trip: null });
    expect(assets.days).toEqual([]);
    expect(assets.photoUrls).toEqual([]);
    expect(assets.mapUrls).toEqual([]);
  });

  it("pairs each map url with a viewport, positionally", () => {
    const withRoute = {
      ...DAY,
      geometry: { type: "LineString", coordinates: [[2.3376, 48.8606], [2.3522, 48.8566]] },
    };
    const assets = collectAssets({ plan: { validated_plan: { days: [withRoute] } } });
    expect(assets.mapUrls).toHaveLength(1);
    expect(assets.viewports).toHaveLength(1);
  });
});

describe("groupPhotosByDay", () => {
  const dayA = { id: "a" };
  const dayB = { id: "b" };

  it("files each image under its own day, at its own stop index", () => {
    const slots = [
      { day: dayA, index: 0 },
      { day: dayA, index: 2 },
      { day: dayB, index: 1 },
    ];
    const byDay = groupPhotosByDay(slots, ["urlA0", "urlA2", "urlB1"]);
    expect(byDay.get(dayA)).toEqual(["urlA0", null, "urlA2"]);
    expect(byDay.get(dayB)).toEqual([null, "urlB1"]);
  });

  it("leaves a hole where an image failed instead of shifting later stops", () => {
    const slots = [
      { day: dayA, index: 0 },
      { day: dayA, index: 1 },
      { day: dayA, index: 2 },
    ];
    const byDay = groupPhotosByDay(slots, ["first", null, "third"]);
    expect(byDay.get(dayA)).toEqual(["first", null, "third"]);
  });

  it("keys on the day object, so two days never share a list", () => {
    const slots = [{ day: dayA, index: 0 }, { day: dayB, index: 0 }];
    const byDay = groupPhotosByDay(slots, ["a", "b"]);
    expect(byDay.size).toBe(2);
    expect(byDay.get(dayA)).toEqual(["a"]);
    expect(byDay.get(dayB)).toEqual(["b"]);
  });

  it("returns nothing for no slots, which is a plan with no photographs", () => {
    expect(groupPhotosByDay([], []).size).toBe(0);
    expect(groupPhotosByDay(null, null).size).toBe(0);
  });
});

describe("pdfFilename", () => {
  it("names the file after the city and the length", () => {
    expect(pdfFilename("Paris, France", 4)).toBe("Paris-itinerary-4d.pdf");
  });

  it("replaces characters that break filesystems rather than dropping words together", () => {
    expect(pdfFilename("San/Sebastián: Costa Rica", 3)).toBe("San-Sebastián-Costa-Rica-itinerary-3d.pdf");
  });

  it("keeps the name from running away", () => {
    const name = pdfFilename(`${"x".repeat(200)}, Somewhere`, 1);
    expect(name.length).toBeLessThan(70);
  });

  it("still produces a usable name with no destination", () => {
    expect(pdfFilename(null, 0)).toBe("trip-itinerary.pdf");
    expect(pdfFilename("", 2)).toBe("trip-itinerary-2d.pdf");
  });
});