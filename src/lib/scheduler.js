/**
 * Deterministic day scheduler.
 *
 * The itinerary agent decides WHAT the group does and on WHICH day. This module
 * decides WHEN, from evidence rather than from an LLM guess: durations come
 * from the place data recorded by the discovery pipeline, travel times come
 * from Mapbox (or a distance estimate when routing is unavailable), and the
 * arithmetic is plain enough to unit test.
 *
 * No network calls live here, so every function is pure and testable.
 */

export const DAY_BOUNDS = {
  fast: { startMin: 8 * 60 + 30, endMin: 20 * 60, scale: 0.9 },
  balanced: { startMin: 9 * 60, endMin: 19 * 60, scale: 1 },
  relaxed: { startMin: 10 * 60, endMin: 18 * 60 + 30, scale: 1.15 },
};

/**
 * Category fallbacks for places the discovery pipeline did not record a
 * duration for. Deliberately conservative: a missing duration should not
 * produce a three-hour lunch.
 */
export const CATEGORY_DURATION_MIN = {
  food: 60,
  culture: 90,
  nature: 75,
  shopping: 60,
  nightlife: 90,
  wellness: 60,
};

const DEFAULT_CATEGORY_DURATION = 75;
const MIN_DURATION_MIN = 20;
const MAX_DURATION_MIN = 180;

/** Mean ground speed in metres per second, by mode. */
const MODE_SPEED_MPS = {
  walking: 1.35,
  driving: 8.3,
};

export function parseClock(value) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatClock(minutesSinceMidnight) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutesSinceMidnight)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Great-circle distance in metres; the fallback when Mapbox is unreachable. */
export function haversineMeters(a, b) {
  if (!a || !b) return 0;
  if (typeof a.lat !== "number" || typeof a.lng !== "number") return 0;
  if (typeof b.lat !== "number" || typeof b.lng !== "number") return 0;

  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * How long a stop actually takes: the recorded duration, or the category
 * fallback, clamped so a bad estimate cannot eat the day.
 */
export function stopDurationMinutes(stop, paceScale = 1) {
  const recorded = Number.isFinite(stop?.estimatedDuration) && stop.estimatedDuration > 0
    ? stop.estimatedDuration
    : null;
  const base = recorded ?? CATEGORY_DURATION_MIN[stop?.category] ?? DEFAULT_CATEGORY_DURATION;
  const scaled = base * paceScale;
  return Math.round(Math.min(Math.max(scaled, MIN_DURATION_MIN), MAX_DURATION_MIN) / 5) * 5;
}

/**
 * Schedules one day.
 *
 * @param {object} options
 * @param {Array} options.stops - ordered stops: { id, name, category, lat, lng,
 *   estimatedDuration }.
 * @param {Array} options.legs - travel between consecutive stops:
 *   { distanceMeters, durationSec }. Length is stops.length - 1 (may be empty).
 * @param {string} options.transportMode - "walking" | "driving".
 * @param {string} options.pace - "fast" | "balanced" | "relaxed".
 * @param {string} [options.startTime] - overrides the pace's start of day.
 * @returns {{
 *   stops: Array, startTime: string, endTime: string, totalMinutes: number,
 *   travelMinutes: number, overflow: boolean
 * }}
 */
export function scheduleDay({
  stops,
  legs = [],
  transportMode = "walking",
  pace = "balanced",
  startTime,
} = {}) {
  const bounds = DAY_BOUNDS[pace] || DAY_BOUNDS.balanced;
  const scale = bounds.scale;
  const ordered = Array.isArray(stops) ? stops : [];

  if (ordered.length === 0) {
    return {
      stops: [],
      startTime: formatClock(bounds.startMin),
      endTime: formatClock(bounds.startMin),
      totalMinutes: 0,
      travelMinutes: 0,
      overflow: false,
    };
  }

  const dayStart = parseClock(startTime) ?? bounds.startMin;

  // The fallback keeps the schedule honest when Mapbox is unavailable: straight
  // line distance at a realistic speed, rounded up to whole minutes. Better a
  // visibly estimated leg than an invented one.
  const legFor = (index) => {
    const provided = legs[index];
    if (provided) {
      const distance = Number.isFinite(provided.distanceMeters)
        ? Math.round(provided.distanceMeters)
        : 0;
      const durationSec = Number.isFinite(provided.durationSec)
        ? provided.durationSec
        : 0;
      if (distance > 0 || durationSec > 0) {
        return {
          distanceMeters: distance,
          durationMin: Math.max(durationSec > 0 ? 1 : 0, Math.ceil(durationSec / 60)),
          estimated: false,
        };
      }
    }

    const from = ordered[index];
    const to = ordered[index + 1];
    const distance = haversineMeters(from, to);
    const speed = MODE_SPEED_MPS[transportMode] || MODE_SPEED_MPS.walking;
    // Straight lines understate real routes, so inflate by 1.25 before timing.
    const durationMin = Math.max(distance > 0 ? 1 : 0, Math.ceil((distance * 1.25) / speed / 60));
    return { distanceMeters: distance, durationMin, estimated: true };
  };

  let cursor = dayStart;
  let travelMinutes = 0;
  let overflow = false;

  // legTimes[i] is the travel from stop i-1 to stop i, so stop i can be moved
  // by it and stop i-1 can display it. Computing it once keeps both uses
  // consistent, and keeps the display leg on the stop it departs from.
  const legTimes = ordered.map((_, index) => (index > 0 ? legFor(index - 1) : null));

  const scheduled = ordered.map((stop, index) => {
    const incoming = legTimes[index];

    if (incoming) {
      cursor += incoming.durationMin;
      travelMinutes += incoming.durationMin;
    }

    const durationMin = stopDurationMinutes(stop, scale);
    const startMin = cursor;
    const endMin = cursor + durationMin;
    cursor = endMin;

    // A stop that ends after the day's close is still given a time, but it is
    // flagged rather than silently dropped -- the group sees the tight slot and
    // can shorten or move it.
    const late = endMin > bounds.endMin;
    if (late) overflow = true;

    const isFood = stop?.category === "food";
    const lunch = isFood && startMin >= 11 * 60 && startMin < 14 * 60;

    return {
      ...stop,
      t: formatClock(startMin),
      end: formatClock(endMin),
      durationMin,
      // The leg shown after this stop is the one departing it.
      leg: index < ordered.length - 1 ? legTimes[index + 1] : null,
      lunch,
      late,
    };
  });

  return {
    stops: scheduled,
    startTime: formatClock(dayStart),
    endTime: formatClock(cursor),
    totalMinutes: cursor - dayStart,
    travelMinutes,
    overflow,
  };
}

/**
 * Formats metres/seconds the way the plan screen shows a leg: "669m · 9min".
 * A zero-distance leg reads as "here", never as "0m · 0min".
 */
export function formatLeg(leg) {
  if (!leg || leg.distanceMeters <= 0) return null;

  const distance = leg.distanceMeters >= 1000
    ? `${(leg.distanceMeters / 1000).toFixed(1)} km`
    : `${Math.round(leg.distanceMeters)}m`;

  if (leg.durationMin <= 0) return distance;
  return `${distance} · ${leg.durationMin}min`;
}
