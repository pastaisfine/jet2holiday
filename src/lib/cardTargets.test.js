import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  CARD_TARGETS,
  DEFAULT_TRIP_DAYS,
  cardCapForDays,
  cardTargetForDays,
  normaliseDays,
} from "./cardTargets";

const HERE = dirname(fileURLToPath(import.meta.url));
const EDGE_FUNCTION = resolve(HERE, "../../supabase/functions/generate-trip/index.ts");

describe("normaliseDays", () => {
  it("rounds to whole days and never drops below one", () => {
    expect(normaliseDays(1)).toBe(1);
    expect(normaliseDays(3.6)).toBe(4);
    expect(normaliseDays(0)).toBe(1);
    expect(normaliseDays(-5)).toBe(1);
  });

  it("falls back to the default rather than producing NaN", () => {
    // An unparseable date must not reach the model as "Trip length: NaN days",
    // which is the sort of string a language model quietly invents around.
    expect(normaliseDays(null)).toBe(DEFAULT_TRIP_DAYS);
    expect(normaliseDays(undefined)).toBe(DEFAULT_TRIP_DAYS);
    expect(normaliseDays("not a date")).toBe(DEFAULT_TRIP_DAYS);
  });
});

describe("cardTargetForDays", () => {
  it("matches the hand-picked table for one to six days", () => {
    expect(cardTargetForDays(1)).toBe(4);
    expect(cardTargetForDays(2)).toBe(7);
    expect(cardTargetForDays(3)).toBe(10);
    expect(cardTargetForDays(4)).toBe(15);
    expect(cardTargetForDays(5)).toBe(19);
    expect(cardTargetForDays(6)).toBe(25);
  });

  it("grows four per day past the table", () => {
    expect(cardTargetForDays(7)).toBe(29);
    expect(cardTargetForDays(8)).toBe(33);
    expect(cardTargetForDays(10)).toBe(41);
    expect(cardTargetForDays(14)).toBe(57);
  });

  it("never decreases as a trip gets longer", () => {
    for (let d = 1; d <= 30; d++) {
      expect(cardTargetForDays(d + 1)).toBeGreaterThanOrEqual(cardTargetForDays(d));
    }
  });
});

describe("cardCapForDays", () => {
  it("leaves the model room to exceed the target by half", () => {
    expect(cardCapForDays(3)).toBe(15);
    // Rounded, so the cap rounds away from the traveller: 25 * 1.5 is 37.5 and
    // 57 * 1.5 is 85.5, both of which go up.
    expect(cardCapForDays(6)).toBe(38);
    expect(cardCapForDays(14)).toBe(86);
  });

  it("stays above the target for every trip length", () => {
    for (let d = 1; d <= 30; d++) {
      expect(cardCapForDays(d)).toBeGreaterThan(cardTargetForDays(d));
    }
  });
});

/**
 * The edge function cannot import from `src/`, so it holds its own copy of the
 * table. Nothing stops the two from drifting except this check: a silent
 * divergence is not a crash, it is the client and the generator quietly sizing
 * the same trip differently, which is exactly the bug the table exists to fix.
 */
describe("edge function copy of the table", () => {
  const source = readFileSync(EDGE_FUNCTION, "utf8");

  const readNumber = (name) => {
    const match = source.match(new RegExp(`const ${name}\\s*(?::[^=]+)?=\\s*([\\d.]+)`));
    expect(match, `edge function should declare ${name}`).toBeTruthy();
    return Number(match[1]);
  };

  it("declares the same literal targets", () => {
    const block = source.match(/const CARD_TARGETS[^=]*=\s*\{([^}]*)\}/);
    expect(block, "edge function should declare CARD_TARGETS").toBeTruthy();

    const parsed = Object.fromEntries(
      [...block[1].matchAll(/(\d+)\s*:\s*(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])])
    );

    expect(parsed).toEqual({ ...CARD_TARGETS });
  });

  it("declares the same extrapolation and cap", () => {
    expect(readNumber("LONG_TRIP_ANCHOR_DAYS")).toBe(6);
    expect(readNumber("LONG_TRIP_SLOPE")).toBe(4);
    expect(readNumber("CARD_CAP_MULTIPLIER")).toBe(1.5);
  });
});