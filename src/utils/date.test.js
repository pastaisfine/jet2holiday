import { describe, it, expect, afterEach } from "vitest";
import { parseTripDate, todayInputValue, fmtDateRange, dayCount } from "./date";

// Trip dates are calendar days, not instants, and these tests are only
// meaningful in a timezone that is not UTC: the bug they guard is the skew
// between "midnight UTC" and "midnight where the traveller is", so a suite
// running under TZ=UTC passes whether the fix is present or not.
const ORIGINAL_TZ = process.env.TZ;

const inTimezone = (tz, run) => {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    process.env.TZ = previous;
  }
};

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("parseTripDate", () => {
  it("reads a YYYY-MM-DD value as the day the traveller picked", () => {
    inTimezone("America/New_York", () => {
      expect(parseTripDate("2026-10-05").getDate()).toBe(5);
      expect(parseTripDate("2026-10-05").getMonth()).toBe(9);
    });
  });

  it("round-trips through toISOString without shifting a day", () => {
    for (const tz of ["America/New_York", "Europe/Berlin", "Asia/Tokyo"]) {
      inTimezone(tz, () => {
        const start = parseTripDate("2026-10-05").toISOString();
        const end = parseTripDate("2026-10-09").toISOString();
        expect(fmtDateRange(start, end), tz).toBe("Oct 5–9");
      });
    }
  });

  it("returns null for empty and unparseable input", () => {
    expect(parseTripDate(null)).toBeNull();
    expect(parseTripDate("")).toBeNull();
    expect(parseTripDate("not-a-date")).toBeNull();
  });

  it("accepts a stored ISO timestamp, not just the date part", () => {
    expect(parseTripDate("2026-10-05T04:00:00.000Z")).not.toBeNull();
    expect(parseTripDate("2026-10-05T04:00:00.000Z").getDate()).toBe(5);
  });
});

describe("todayInputValue", () => {
  it("returns today on the local calendar, not the UTC one", () => {
    for (const tz of ["America/New_York", "Europe/Berlin", "Pacific/Auckland"]) {
      inTimezone(tz, () => {
        const expected = new Date();
        const local = new Date(
          expected.getTime() - expected.getTimezoneOffset() * 60000
        );
        expect(todayInputValue(), tz).toBe(local.toISOString().slice(0, 10));
      });
    }
  });
});

describe("dayCount", () => {
  it("counts a trip in calendar days", () => {
    const start = parseTripDate("2026-10-05").toISOString();
    const end = parseTripDate("2026-10-09").toISOString();
    expect(dayCount(start, end)).toBe(5);
  });
});
