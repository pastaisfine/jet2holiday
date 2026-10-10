import { describe, it, expect, vi, beforeEach } from "vitest";
import { fitWithin } from "./assets.js";

describe("fitWithin", () => {
  it("leaves an image already inside the budget alone", () => {
    expect(fitWithin(400, 300, 600)).toEqual({ width: 400, height: 300 });
    expect(fitWithin(600, 600, 600)).toEqual({ width: 600, height: 600 });
  });

  it("scales the long edge down to the budget and keeps the ratio", () => {
    expect(fitWithin(1000, 1000, 600)).toEqual({ width: 600, height: 600 });
    const wide = fitWithin(4000, 1000, 600);
    expect(wide.width).toBe(600);
    expect(wide.height).toBe(150);
  });

  it("keeps a tall image's height as the long edge", () => {
    const tall = fitWithin(1000, 4000, 600);
    expect(tall.height).toBe(600);
    expect(tall.width).toBe(150);
  });

  it("never rounds a dimension down to zero", () => {
    // A 4000x1 panorama would scale height to 0.15 and round to 0, and a
    // zero-sized canvas throws in most browsers.
    const sliver = fitWithin(4000, 1, 600);
    expect(sliver.width).toBe(600);
    expect(sliver.height).toBe(1);
  });

  it("returns nothing usable for an unreadable size", () => {
    expect(fitWithin(0, 0, 600)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(undefined, 100, 600)).toEqual({ width: 0, height: 0 });
  });
});

describe("assets in a non-browser environment", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports no image rather than throwing, so a node render still works", async () => {
    const { loadImageDataUrl, loadImages } = await import("./assets.js");
    await expect(loadImageDataUrl("https://example.com/a.jpg")).resolves.toBeNull();
    await expect(loadImages([])).resolves.toEqual([]);
  });

  it("keeps positional alignment when images cannot load", async () => {
    const { loadImages } = await import("./assets.js");
    const results = await loadImages(["https://a/1.jpg", "", "https://a/3.jpg"]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r === null)).toBe(true);
  });
});