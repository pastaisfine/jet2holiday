/**
 * Getting remote images into the PDF as bytes jsPDF can embed.
 *
 * jsPDF embeds a data URL, not a URL, so every image has to be fetched and
 * re-encoded in the browser before the document is drawn. That has three
 * consequences this module exists to absorb:
 *
 *   1. SIZE. Card photos are 1000x1000 and around 400 KB each. A five-day trip
 *      is roughly twelve megabytes of raw JPEG, which is an unopenable PDF.
 *      Every image is downscaled to print resolution before embedding, which
 *      takes the same trip to about 1.5 MB.
 *
 *   2. CORS. A canvas cannot be read back once it is tainted, so a photo has to
 *      arrive as bytes we were allowed to have -- not as a URL a <img> would
 *      happily display. Fetching to a blob and decoding the blob leaves the
 *      canvas same-origin, because the blob URL is ours. Pointing an <img> at
 *      the remote host instead would taint it and toDataURL would throw.
 *      Every image in the deck is copied into our own Supabase bucket at
 *      generation time (supabase/functions/generate-trip, upgradePhoto) and
 *      that bucket serves `access-control-allow-origin: *`, so this works.
 *      The hotlink fallback is still attempted; if a host ever refuses, the
 *      image is dropped and the layout closes the gap.
 *
 *   3. LATENCY. Thirty photos and five maps at once is enough to make a phone
 *      swap. Requests go through a small concurrency pool and report progress,
 *      so the button can say what it is waiting for instead of looking hung.
 *
 * Everything here degrades to null rather than throwing: a missing image is a
 * layout decision, never a failed export.
 */

import { MAP_PX, PIN, projectPoint } from "./mapshot.js";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CONCURRENCY = 4;

/** URL -> data URL, for the life of the page. */
const cache = new Map();

/** In-flight fetches, so two sections wanting the same photo share one request. */
const pending = new Map();

function hasBrowserCanvas() {
  return (
    typeof window !== "undefined" &&
    typeof window.fetch === "function" &&
    typeof window.Image === "function" &&
    typeof document !== "undefined"
  );
}

/**
 * Decodes image bytes into something drawable.
 *
 * createImageBitmap is the fast path and is the only one that gives a
 * predictable decode size; the <img> path is the fallback for the browsers
 * where it is missing. Both take a blob URL, which is what keeps the canvas
 * untainted.
 */
async function decode(blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    if (typeof window.createImageBitmap === "function") {
      return await window.createImageBitmap(blob);
    }
    const image = new window.Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not decode image"));
      image.src = objectUrl;
    });
    return image;
  } finally {
    // The bitmap may decode lazily, so the revoke is scheduled after the paint
    // rather than run immediately. Callers release via the `close` helper.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
}

function release(decoded) {
  if (decoded && typeof decoded.close === "function") decoded.close();
}

function newCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Longest-edge target for an image of a given pixel size.
 *
 * Used by loadImageDataUrl's callers only through the constant defaults; the
 * point of exporting it is that stop blocks and maps want different print
 * resolutions and a shared helper is easier to reason about than a magic
 * number in two places.
 */
export function fitWithin(width, height, maxPx) {
  if (!width || !height) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxPx) return { width, height };
  const scale = maxPx / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Encodes a drawn canvas as a JPEG data URL. */
function toJpeg(canvas, quality) {
  return canvas.toDataURL("image/jpeg", quality);
}

async function fetchBlob(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Image request failed: ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (type && !type.startsWith("image/")) throw new Error(`Not an image: ${type}`);
  return res.blob();
}

/**
 * Fetch, downscale, and return a data URL for one image.
 *
 * Returns null on any failure. That is deliberate and load-bearing: the caller
 * is halfway through laying out a page, and throwing there would lose the whole
 * export over one dead thumbnail.
 */
export async function loadImageDataUrl(url, { maxPx, quality, timeoutMs } = {}) {
  if (!url || typeof url !== "string") return null;
  if (cache.has(url)) return cache.get(url);
  if (pending.has(url)) return pending.get(url);
  if (!hasBrowserCanvas()) return null;

  const promise = (async () => {
    let decoded = null;
    try {
      const blob = await fetchBlob(url, timeoutMs ?? DEFAULT_TIMEOUT_MS);
      decoded = await decode(blob);
      const sourceWidth = decoded.width || blob.width || 0;
      const sourceHeight = decoded.height || 0;
      const target = fitWithin(sourceWidth, sourceHeight, maxPx ?? 600);

      if (!target.width) return null;

      const canvas = newCanvas(target.width, target.height);
      const ctx = canvas.getContext("2d");
      // JPEG has no alpha, so unpainted pixels would come out black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, target.width, target.height);
      ctx.drawImage(decoded, 0, 0, target.width, target.height);
      return toJpeg(canvas, quality ?? 0.7);
    } catch (err) {
      console.warn("[pdf] skipping image:", url, err?.message || err);
      return null;
    } finally {
      release(decoded);
    }
  })();

  pending.set(url, promise);
  const result = await promise;
  pending.delete(url);
  cache.set(url, result);
  return result;
}

/**
 * Loads many images with a bounded number in flight.
 *
 * Results are returned positionally, null where an image failed, so the caller
 * can index by stop without tracking which promise belonged to which stop.
 */
export async function loadImages(urls, { concurrency, onProgress, ...options } = {}) {
  const list = Array.isArray(urls) ? urls : [];
  const results = new Array(list.length).fill(null);
  if (!list.length) return results;

  const limit = Math.max(1, Math.min(concurrency ?? DEFAULT_CONCURRENCY, list.length));
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await loadImageDataUrl(list[index], options);
      done += 1;
      onProgress?.(done, list.length);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

/**
 * Draws the numbered stop markers onto a rendered day map.
 *
 * The map comes from Mapbox with the route drawn on it and no markers, because
 * the Static Images API renders exactly one of several comma-separated pins
 * (see mapshot.js). We already know the camera, so projecting each stop and
 * painting it here is both more correct and better looking than fighting the
 * overlay parser.
 *
 * Markers are numbered by the stop's index in the day, not by its order among
 * the stops that happen to have coordinates, so pin 4 lines up with the fourth
 * entry in the printed list even if an earlier one had no location.
 */
export async function annotateMap(dataUrl, { points, viewport, widthPx, heightPx } = {}) {
  if (!dataUrl || !viewport || !points?.length) return dataUrl;
  if (!hasBrowserCanvas()) return dataUrl;

  let decoded = null;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    decoded = await decode(blob);

    // The map was requested at @2x, so the marker sizes and offsets scale with
    // the real bitmap rather than the nominal viewport size.
    const scale = decoded.width / (widthPx ?? MAP_PX.width);
    const canvas = newCanvas(decoded.width, decoded.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(decoded, 0, 0);

    for (const point of points) {
      const { x, y } = projectPoint([point.lng, point.lat], viewport, {
        widthPx: widthPx ?? MAP_PX.width,
        heightPx: heightPx ?? MAP_PX.height,
      });

      // A stop outside the frame cannot be marked; the padding in mapViewport
      // means this only happens when the route itself overflowed.
      const px = x * scale;
      const py = y * scale;
      if (px < 0 || py < 0 || px > canvas.width || py > canvas.height) continue;

      const radius = PIN.radius * scale;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${PIN.color.join(",")})`;
      ctx.fill();
      // A hairline keeps the marker legible over dark parkland as well as pale
      // streets.
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();

      ctx.fillStyle = `rgb(${PIN.labelColor.join(",")})`;
      ctx.font = `700 ${Math.round(radius * 1.25)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.min(point.index + 1, 99)), px, py + radius * 0.04);
    }

    return toJpeg(canvas, 0.82);
  } catch (err) {
    console.warn("[pdf] could not annotate map:", err?.message || err);
    return dataUrl;
  } finally {
    release(decoded);
  }
}