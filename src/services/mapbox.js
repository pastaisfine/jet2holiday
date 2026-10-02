const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// Optimization API's documented ceiling on coordinates per request. Days in
// this app hold 2-6 stops, so the cap is a guard rail rather than a limit the
// itinerary ever reaches.
const OPTIMIZE_MAX_COORDS = 12;

function coordsParam(coordinates) {
  return coordinates.map((c) => `${c.lng},${c.lat}`).join(";");
}

export async function getDirections(coordinates) {
  const token = MAPBOX_TOKEN;
  if (!token || coordinates.length < 2) return null;

  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coordsParam(coordinates)}?geometries=geojson&access_token=${token}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes[0]) {
      return data.routes[0].geometry;
    }
  } catch (err) {
    console.error("Mapbox Directions error:", err);
  }
  return null;
}

/**
 * Fetches the route for one day's ordered stops.
 *
 * Returns the full-route geometry for the map and per-leg distance/duration for
 * the scheduler, in one call. Returns null on any failure so the caller can
 * fall back to distance estimates instead of blocking the plan.
 *
 * @param {{lat: number, lng: number}[]} coordinates ordered stops
 * @param {"walking"|"driving"} profile
 * @returns {Promise<{geometry: object|null, legs: {distanceMeters: number, durationSec: number}[]}|null>}
 */
export async function getDayRoute(coordinates, profile = "walking") {
  const token = MAPBOX_TOKEN;
  if (!token || coordinates.length < 2) return null;

  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordsParam(coordinates)}` +
    `?geometries=geojson&overview=full&annotations=distance,duration&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return null;

    return {
      geometry: route.geometry || null,
      legs: (route.legs || []).map((leg) => ({
        distanceMeters: Number.isFinite(leg.distance) ? leg.distance : 0,
        durationSec: Number.isFinite(leg.duration) ? leg.duration : 0,
      })),
    };
  } catch (err) {
    console.error("Mapbox day route error:", err);
    return null;
  }
}

/**
 * Reorders a day's stops for minimum travel time with Mapbox's Optimization
 * API. Round trips are off: a day starts at its first stop and ends at its
 * last, so the source and destination are pinned rather than chosen.
 *
 * Returns an array of indices into `coordinates` in optimized order, or null
 * when the API is unavailable (unentitled token, quota, network) so the caller
 * can keep the itinerary agent's day grouping.
 */
export async function optimizeDayOrder(coordinates, profile = "walking") {
  const token = MAPBOX_TOKEN;
  if (!token || coordinates.length < 3 || coordinates.length > OPTIMIZE_MAX_COORDS) {
    return null;
  }

  const url =
    `https://api.mapbox.com/optimized-trips/v1/mapbox/${profile}/${coordsParam(coordinates)}` +
    `?roundtrip=false&source=first&destination=last&geometries=geojson&overview=full&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const waypoints = data?.waypoints;
    if (!Array.isArray(waypoints) || waypoints.length !== coordinates.length) return null;

    const order = waypoints
      .map((waypoint, inputIndex) => ({
        inputIndex,
        position: Number.isFinite(waypoint.waypoint_index) ? waypoint.waypoint_index : inputIndex,
      }))
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.inputIndex);

    // A malformed or identity response is not worth reordering for.
    if (order.length !== coordinates.length) return null;
    return order;
  } catch (err) {
    console.error("Mapbox optimization error:", err);
    return null;
  }
}
