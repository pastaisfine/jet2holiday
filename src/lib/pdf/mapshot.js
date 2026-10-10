/**
 * Mapbox Static Images URLs for the per-day map in the itinerary PDF.
 *
 * The plan already has each day's route as GeoJSON on `day.geometry` (Mapbox
 * Directions, via services/mapbox.js), so the PDF needs a renderer for it and
 * nothing more. Static Images is the right tool: one GET returns a finished
 * PNG, needs no canvas work and no CORS surprises, and costs nothing against
 * the Directions quota the plan build already spends.
 *
 * The viewport is computed here rather than handed to Mapbox's `auto`, because
 * `auto` fits the geometry edge to edge and a route that runs off all four
 * sides of a 58mm-tall image reads as a mistake. Fitting the padded bounds
 * ourselves costs one mercator calculation and keeps the whole day on the page.
 *
 * Pure string and number work: no network, no jsPDF. Tested directly.
 */

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const STATIC_BASE = "https://api.mapbox.com/styles/v1/mapbox/streets-v12/static";

/** Static Images caps zoom at 20; past street level there is nothing to gain. */
const MAX_ZOOM = 17;
const MIN_ZOOM = 1;

/**
 * The image we ask Mapbox for, in CSS pixels. Requested at @2x so the print
 * resolution survives; the pin overlay is drawn on top at this size and the
 * whole canvas is downscaled once on the way into the PDF.
 */
export const MAP_PX = { width: 600, height: 290 };

/** Marker fill and label, drawn by us rather than by the API -- see below. */
export const PIN = { radius: 11, color: [17, 23, 15], labelColor: [255, 255, 255] };

/**
 * Pulls `[lng, lat]` pairs out of whatever shape the route arrived in.
 *
 * Mapbox Directions returns a bare LineString, but `day.geometry` has been
 * through a JSONB column and a couple of different writers since, so a Feature
 * or FeatureCollection is a real possibility and MultiLineString is not worth
 * ruling out. Accepting all four is cheaper than a support ticket.
 */
export function geometryCoordinates(geometry) {
  if (!geometry || typeof geometry !== "object") return [];

  if (geometry.type === "FeatureCollection") {
    const out = [];
    for (const feature of geometry.features || []) {
      out.push(...geometryCoordinates(feature));
    }
    return out;
  }
  if (geometry.type === "Feature") return geometryCoordinates(geometry.geometry);

  // Only the line types are a route. A Point has a coordinate too, and letting
  // it through would make `length >= 2` the only thing standing between a dot
  // and a drawn line -- so say no here instead of relying on the caller.
  if (geometry.type !== "LineString" && geometry.type !== "MultiLineString") return [];

  const out = [];
  const collect = (coords) => {
    if (!Array.isArray(coords)) return;
    // A coordinate is [lng, lat]; anything longer (elevation) is still ours.
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      out.push([coords[0], coords[1]]);
      return;
    }
    for (const entry of coords) collect(entry);
  };
  collect(geometry.coordinates);
  return out;
}

/** Mercator y for a latitude, normalised to 0..1. Used to fit the viewport. */
function mercatorY(lat) {
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
}

/**
 * The viewport that fits `coordinates` into a pixel box with padding, expressed
 * the way Static Images wants it: `{lon},{lat},{zoom},{bearing},{pitch}`.
 *
 * Exported because the fit is the part with arithmetic in it, and arithmetic
 * deserves a test more than string concatenation does.
 */
export function mapViewport(coordinates, { widthPx, heightPx, padding = 0.14 } = {}) {
  if (!coordinates.length) return null;

  const lngs = coordinates.map((c) => c[0]);
  const lats = coordinates.map((c) => c[1]);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);

  // A single stop, or a day whose stops all sit on one spot: there is no span to
  // fit, so centre it and pick a zoom by hand.
  if (west === east && south === north) {
    return { lon: west, lat: south, zoom: 14, bearing: 0, pitch: 0 };
  }

  const availW = Math.max(1, widthPx * (1 - padding * 2));
  const availH = Math.max(1, heightPx * (1 - padding * 2));
  const worldPx = 256;

  // At zoom z the world is 360 degrees across and worldPx * 2^z pixels wide, so
  // pixels-per-degree-longitude carries the /360. Latitude is already in
  // mercator's normalised 0..1, so its span does not.
  const spanX = ((east - west) / 360) * worldPx;
  const spanY = (mercatorY(north) - mercatorY(south)) * worldPx;
  if (spanX <= 0 && spanY <= 0) {
    return { lon: west, lat: south, zoom: 14, bearing: 0, pitch: 0 };
  }

  const zoomX = spanX > 0 ? Math.log2(availW / spanX) : MAX_ZOOM;
  const zoomY = spanY > 0 ? Math.log2(availH / spanY) : MAX_ZOOM;

  return {
    lon: (west + east) / 2,
    lat: (south + north) / 2,
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(Math.min(zoomX, zoomY)))),
    bearing: 0,
    pitch: 0,
  };
}

/**
 * Pins are NOT asked of the Static Images API.
 *
 * The documented form is `pin-s-1+11170f(lng,lat),pin-s-2+...` and it returns
 * 200, but it renders exactly one marker: the API's overlay parser splits on
 * the commas and does not recover. Asking for three produced a single pin at
 * stop 1's coordinates wearing stop 2's label -- wrong position and wrong
 * number, which is worse than no pins at all because it silently misnumbers the
 * itinerary. Letters and digits both misbehave, and percent-encoding the inner
 * commas does not help.
 *
 * Since mapViewport already computes the camera, projecting each stop into
 * pixel space is one more pure function and gives us markers in brand colours
 * that are numbered by the same array index the itinerary body uses.
 */
/**
 * Static Images rejects anything over 8192 characters, and a walked route from
 * the Directions API arrives with hundreds of coordinates that encode to far
 * more than that. Two reductions, in the order that costs the least accuracy:
 *
 *   1. Five decimal places. That is about a metre, and the printed map is 58mm
 *      tall, so the extra digits Mapbox gave us were never resolvable.
 *   2. Uniform sampling down to MAX_ROUTE_POINTS. Mapbox's own guidance for
 *      encoded paths is that redundant coordinates add nothing on web mercator;
 *      keeping first and last preserves the day's start and end exactly, which
 *      is where a reader looks to check the map against the list.
 */
const MAX_ROUTE_POINTS = 110;

function compactRoute(coordinates) {
  const rounded = coordinates.map(([lng, lat]) => [
    Number(lng.toFixed(5)),
    Number(lat.toFixed(5)),
  ]);
  if (rounded.length <= MAX_ROUTE_POINTS) return rounded;

  const step = (rounded.length - 1) / (MAX_ROUTE_POINTS - 1);
  const sampled = [];
  for (let i = 0; i < MAX_ROUTE_POINTS; i += 1) {
    sampled.push(rounded[Math.round(i * step)]);
  }
  return sampled;
}

function routeOverlay(coordinates) {
  const collection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { "stroke-width": 5, "stroke-opacity": 0.95, "stroke": "#c9b235" },
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
  return `geojson(${encodeURIComponent(JSON.stringify(collection))})`;
}

/** Coordinate pairs for stops that actually have a position. */
export function stopPoints(stops) {
  return (stops || [])
    .map((stop, index) => ({
      index,
      lng: stop?.lng,
      lat: stop?.lat,
      name: stop?.name,
    }))
    .filter((point) => typeof point.lat === "number" && typeof point.lng === "number");
}

/**
 * Where a coordinate lands in the rendered image, in pixels from the top-left.
 *
 * Pure inverse of the mercator projection mapViewport fits with, so a stop that
 * produced the camera lands the pixel we draw it at.
 */
export function projectPoint([lng, lat], viewport, { widthPx, heightPx }) {
  const scale = 256 * 2 ** viewport.zoom;
  const worldX = ((lng + 180) / 360) * scale;
  const worldY = (0.5 - mercatorY(lat)) * scale;
  const centreX = ((viewport.lon + 180) / 360) * scale;
  const centreY = (0.5 - mercatorY(viewport.lat)) * scale;
  return {
    x: worldX - centreX + widthPx / 2,
    y: worldY - centreY + heightPx / 2,
  };
}

/**
 * A finished PNG URL for one day, or null when there is nothing to draw or no
 * token. Null is the signal throughout: the caller omits the map and the day
 * reflows, rather than the whole export failing.
 *
 * @param {object} day a validated-plan day
 * @param {{token?: string}} [options] override the env token (tests)
 */
export function staticMapUrl(day, { token = MAPBOX_TOKEN } = {}) {
  if (!token || !day) return null;

  const route = compactRoute(geometryCoordinates(day.geometry));
  if (route.length < 2) return null;

  const viewport = mapViewport(route, { widthPx: MAP_PX.width, heightPx: MAP_PX.height });
  if (!viewport) return null;

  const view = `${viewport.lon.toFixed(6)},${viewport.lat.toFixed(6)},${viewport.zoom},${viewport.bearing},${viewport.pitch}`;
  return `${STATIC_BASE}/${routeOverlay(route)}/${view}/${MAP_PX.width}x${MAP_PX.height}@2x?access_token=${token}`;
}

/**
 * The camera for a day's map: framing the route when there is one, and the
 * stops themselves when routing failed for that day, so a day still gets a map
 * even though it gets no line.
 */
export function dayViewport(day) {
  if (!day) return null;
  const route = geometryCoordinates(day.geometry);
  const bounds = route.length >= 2 ? route : stopPoints(day.stops).map((p) => [p.lng, p.lat]);
  if (!bounds.length) return null;
  return mapViewport(bounds, { widthPx: MAP_PX.width, heightPx: MAP_PX.height });
}