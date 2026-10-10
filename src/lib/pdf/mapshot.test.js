import { describe, it, expect } from "vitest";
import {
  dayViewport,
  geometryCoordinates,
  mapViewport,
  projectPoint,
  staticMapUrl,
  stopPoints,
} from "./mapshot.js";

/** A short Paris walk, in the shape `day.geometry` actually arrives in. */
const LINE = {
  type: "LineString",
  coordinates: [
    [2.3522, 48.8566],
    [2.3376, 48.8606],
    [2.2945, 48.8584],
  ],
};

const STOPS = [
  { lat: 48.8566, lng: 2.3522 },
  { lat: 48.8606, lng: 2.3376 },
  { lat: 48.8584, lng: 2.2945 },
];

describe("geometryCoordinates", () => {
  it("reads a bare LineString", () => {
    expect(geometryCoordinates(LINE)).toHaveLength(3);
  });

  it("reads a Feature", () => {
    const wrapped = { type: "Feature", geometry: LINE, properties: {} };
    expect(geometryCoordinates(wrapped)).toEqual(LINE.coordinates);
  });

  it("reads a FeatureCollection, which is how some writers store it", () => {
    const collection = { type: "FeatureCollection", features: [{ type: "Feature", geometry: LINE }] };
    expect(geometryCoordinates(collection)).toHaveLength(3);
  });

  it("flattens a MultiLineString", () => {
    const multi = { type: "MultiLineString", coordinates: [LINE.coordinates, [[2.3, 48.85]]] };
    expect(geometryCoordinates(multi)).toHaveLength(4);
  });

  it("returns nothing for the shapes that carry no route", () => {
    expect(geometryCoordinates(null)).toEqual([]);
    expect(geometryCoordinates(undefined)).toEqual([]);
    expect(geometryCoordinates({ type: "Point", coordinates: [2, 48] })).toEqual([]);
    expect(geometryCoordinates({ type: "GeometryCollection", geometries: [] })).toEqual([]);
  });
});

describe("mapViewport", () => {
  it("centres on the midpoint of the bounds", () => {
    const view = mapViewport(LINE.coordinates, { widthPx: 600, heightPx: 290 });
    expect(view.lon).toBeCloseTo((2.3522 + 2.2945) / 2, 5);
    expect(view.lat).toBeCloseTo((48.8566 + 48.8606) / 2, 5);
  });

  it("zooms out for a wide span and in for a tight one", () => {
    const wide = mapViewport(
      [
        [2.29, 48.85],
        [2.36, 48.87],
      ],
      { widthPx: 600, heightPx: 290 },
    );
    const tight = mapViewport(
      [
        [2.3522, 48.8566],
        [2.3523, 48.8567],
      ],
      { widthPx: 600, heightPx: 290 },
    );
    expect(wide.zoom).toBeLessThan(tight.zoom);
  });

  it("stays inside the Static Images zoom range", () => {
    const single = mapViewport([[2.35, 48.85]], { widthPx: 600, heightPx: 290 });
    expect(single.zoom).toBeGreaterThanOrEqual(1);
    expect(single.zoom).toBeLessThanOrEqual(17);

    const continental = mapViewport(
      [
        [-5, 40],
        [10, 55],
      ],
      { widthPx: 600, heightPx: 290 },
    );
    expect(continental.zoom).toBeGreaterThanOrEqual(1);
  });

  it("gives a single stop a usable zoom rather than dividing by zero", () => {
    const view = mapViewport([[2.3522, 48.8566]], { widthPx: 600, heightPx: 290 });
    expect(view.lon).toBeCloseTo(2.3522, 5);
    expect(view.zoom).toBeGreaterThan(1);
  });

  it("returns null with nothing to frame", () => {
    expect(mapViewport([], { widthPx: 600, heightPx: 290 })).toBeNull();
  });

  it("handles a purely vertical span without producing NaN", () => {
    const view = mapViewport(
      [
        [2.35, 48.85],
        [2.35, 48.87],
      ],
      { widthPx: 600, heightPx: 290 },
    );
    expect(Number.isFinite(view.zoom)).toBe(true);
    expect(Number.isFinite(view.lon)).toBe(true);
  });
});

describe("staticMapUrl", () => {
  it("returns null without a token, so a missing env var fails soft", () => {
    expect(staticMapUrl({ geometry: LINE, stops: STOPS }, { token: "" })).toBeNull();
  });

  it("returns null for a day with no geometry and no stops", () => {
    expect(staticMapUrl({ geometry: null, stops: [] }, { token: "t" })).toBeNull();
    expect(staticMapUrl(null, { token: "t" })).toBeNull();
  });

  it("builds a Static Images url carrying the route", () => {
    const url = staticMapUrl({ geometry: LINE, stops: STOPS }, { token: "TESTTOKEN" });
    expect(url).toContain("api.mapbox.com/styles/v1/mapbox/streets-v12/static/");
    expect(url).toContain("geojson(");
    expect(url).toContain("600x290@2x");
    expect(url).toContain("access_token=TESTTOKEN");
  });

  it("asks for no pins, because the API only ever draws the first one", () => {
    const url = staticMapUrl({ geometry: LINE, stops: STOPS }, { token: "T" });
    expect(url).not.toContain("pin-s-");
  });

  it("returns null when there is no route, leaving the map to dayViewport", () => {
    expect(staticMapUrl({ geometry: null, stops: STOPS }, { token: "T" })).toBeNull();
    expect(
      staticMapUrl({ geometry: { type: "LineString", coordinates: [[2, 48]] } }, { token: "T" }),
    ).toBeNull();
  });

  it("keeps the request under the 8192 character limit Mapbox allows", () => {
    // A dense real route is the case that would blow it; 900 coordinates is far
    // past any itinerary we generate, and each pair here is full float noise.
    const dense = {
      type: "LineString",
      coordinates: Array.from({ length: 900 }, (_, i) => [
        2.3 + Math.sin(i) * 0.01 + i * 1e-9,
        48.85 + Math.cos(i) * 0.01,
      ]),
    };
    const url = staticMapUrl({ geometry: dense, stops: STOPS }, { token: "x".repeat(200) });
    expect(url.length).toBeLessThan(8192);
  });

  it("keeps the first and last coordinate of a decimated route", () => {
    // First and last are where a reader checks the map against the list.
    const dense = {
      type: "LineString",
      coordinates: Array.from({ length: 900 }, (_, i) => [2.3 + i * 1e-5, 48.85 + i * 1e-5]),
    };
    const url = staticMapUrl({ geometry: dense, stops: [] }, { token: "T" });
    const geojson = decodeURIComponent(
      url.split("/static/")[1].split("?")[0].slice("geojson(".length).split(")")[0],
    );
    const coords = JSON.parse(geojson).features[0].geometry.coordinates;
    expect(coords[0]).toEqual([2.3, 48.85]);
    expect(coords[coords.length - 1]).toEqual([2.30899, 48.85899]);
  });

  it("falls back to the stops themselves when routing failed for the day", () => {
    const view = dayViewport({ geometry: null, stops: STOPS });
    expect(view).toBeTruthy();
    expect(view.zoom).toBeGreaterThan(1);
  });

  it("has no viewport for a day with neither route nor stops", () => {
    expect(dayViewport({ geometry: null, stops: [] })).toBeNull();
    expect(dayViewport(null)).toBeNull();
  });
});

describe("stopPoints", () => {
  it("keeps each stop's real index, so pins match the itinerary numbering", () => {
    const points = stopPoints([{ name: "no coords" }, { lat: 1, lng: 2 }, { lat: 3, lng: 4 }]);
    expect(points.map((p) => p.index)).toEqual([1, 2]);
    expect(points.map((p) => p.name)).toEqual([undefined, undefined]);
  });

  it("drops stops that never got coordinates", () => {
    expect(stopPoints([{ lat: 1, lng: 2 }, { name: "x" }, null])).toHaveLength(1);
    expect(stopPoints([])).toEqual([]);
    expect(stopPoints(null)).toEqual([]);
  });
});

describe("projectPoint", () => {
  const bounds = {
    widthPx: 600,
    heightPx: 290,
  };

  it("puts the viewport centre in the middle of the image", () => {
    const route = LINE.coordinates;
    const view = mapViewport(route, bounds);
    const centre = projectPoint([view.lon, view.lat], view, bounds);
    expect(centre.x).toBeCloseTo(bounds.widthPx / 2, 5);
    expect(centre.y).toBeCloseTo(bounds.heightPx / 2, 5);
  });

  it("puts north above south, and east right of west", () => {
    const view = mapViewport(LINE.coordinates, bounds);
    const southWest = projectPoint([2.2945, 48.8566], view, bounds);
    const northEast = projectPoint([2.3522, 48.8606], view, bounds);
    expect(northEast.y).toBeLessThan(southWest.y);
    expect(northEast.x).toBeGreaterThan(southWest.x);
  });

  it("keeps every stop of a fitted day inside the image", () => {
    const view = mapViewport(LINE.coordinates, bounds);
    for (const stop of STOPS) {
      const { x, y } = projectPoint([stop.lng, stop.lat], view, bounds);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(bounds.widthPx);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(bounds.heightPx);
    }
  });

  it("scales longitude by the web-mercator width at the fitted zoom", () => {
    // At zoom z the world is 360 degrees across 256 * 2^z pixels. If projection
    // drifts from that, every pin lands somewhere other than its stop.
    const view = { lon: 2.33, lat: 48.86, zoom: 13, bearing: 0, pitch: 0 };
    const a = projectPoint([2.3, 48.86], view, bounds);
    const b = projectPoint([2.4, 48.86], view, bounds);
    const expected = (0.1 * (256 * 2 ** 13)) / 360;
    expect(b.x - a.x).toBeCloseTo(expected, 6);
    expect(b.y - a.y).toBeCloseTo(0, 6);
  });

  it("keeps latitude spacing mercator-stretched away from the equator", () => {
    // Two stops 0.1 degrees apart at Paris latitude must be further apart in
    // pixels than the same 0.1 degrees at the equator.
    const view = { lon: 2.33, lat: 48.86, zoom: 13, bearing: 0, pitch: 0 };
    const north = projectPoint([2.33, 48.96], view, bounds);
    const south = projectPoint([2.33, 48.86], view, bounds);
    const atEquator = 0.1 * ((256 * 2 ** 13) / 360);
    expect(south.y - north.y).toBeGreaterThan(atEquator);
  });
});

describe("staticMapUrl encoding", () => {
  it("encodes the geojson so coordinates cannot break the path", () => {
    const url = staticMapUrl({ geometry: LINE, stops: STOPS }, { token: "T" });
    // Raw braces and quotes in the path would be read as overlay separators.
    const path = url.split("/static/")[1].split("?")[0];
    const geojsonPart = path.slice("geojson(".length).split(")")[0];
    expect(geojsonPart).not.toContain('"');
    expect(decodeURIComponent(geojsonPart)).toContain("LineString");
  });
});