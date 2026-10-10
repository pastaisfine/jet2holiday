/**
 * The itinerary PDF.
 *
 * Assembles the confirmed plan into a printable document, in the browser, for
 * every member of the trip. There is no server-side renderer and no stored
 * file: each person downloads their own copy from the same live plan, which
 * means the PDF always matches what they can see on screen -- including any
 * change that landed after the plan was confirmed, since members keep voting
 * suggestions through and the plan is not immutable.
 *
 * The order of work matters and is not arbitrary:
 *
 *   1. Collect every image the document will need, in one pooled pass, before
 *      any page is drawn. Fetching lazily during layout would mean a network
 *      round trip between measuring a block and drawing it, which is how a
 *      progress bar ends up going backwards.
 *   2. Draw. Layout itself is synchronous and never fails on a missing image,
 *      because step 1 already turned every failure into a null.
 *   3. Footers last, because they need the final page count.
 */

import jsPDF from "jspdf";

import { COLOR, PAGE, PHOTO, TYPE } from "./theme.js";
import { Flow } from "./flow.js";
import { loadImageDataUrl, loadImages, annotateMap } from "./assets.js";
import { staticMapUrl, dayViewport, stopPoints, MAP_PX } from "./mapshot.js";
import { drawCover } from "./sections/cover.js";
import { drawStory } from "./sections/story.js";
import { drawDay } from "./sections/day.js";

/** Everything the document needs that is not already on `plan`. */
export function collectAssets({ trip, plan, members }) {
  const validated = plan?.validated_plan || {};
  const days = Array.isArray(validated.days) ? validated.days : [];

  const photoUrls = [];
  const photoSlots = [];
  for (const day of days) {
    for (const [index, stop] of (day.stops || []).entries()) {
      if (!stop?.img) continue;
      photoSlots.push({ day, index });
      photoUrls.push(stop.img);
    }
  }

  return {
    validated,
    days,
    photoUrls,
    photoSlots,
    mapUrls: days.map((day) => staticMapUrl(day)),
    viewports: days.map((day) => dayViewport(day)),
    destination: trip?.destination,
    members,
  };
}

/**
 * Grouping loaded images back onto the stop each one belongs to.
 *
 * This is the step that silently produced a document with no photographs: the
 * images loaded fine, the skip counter said nothing was missing, and every stop
 * still came out text-only because the images had been filed under an undefined
 * day. Two parallel lists and a Map is exactly the shape of bug that no
 * assertion about the fetch layer will catch, so it is a named function with
 * tests rather than four lines inside the orchestrator.
 */
export function groupPhotosByDay(photoSlots = [], photos = []) {
  const byDay = new Map();
  (photoSlots || []).forEach((slot, position) => {
    const dataUrl = photos?.[position];
    if (!dataUrl || !slot) return;
    if (!byDay.has(slot.day)) byDay.set(slot.day, []);
    const list = byDay.get(slot.day);
    // Pad the gap so a stop whose photo failed leaves a hole in the right
    // position rather than sliding every later stop up one place.
    while (list.length < slot.index) list.push(null);
    list[slot.index] = dataUrl;
  });
  return byDay;
}

/**
 * A filename that survives every filesystem and still says what it is.
 *
 * The destination goes in because a person who downloads five trip PDFs should
 * be able to tell them apart in a downloads folder; the characters that break
 * on Windows or in a URL are replaced rather than stripped so the name does not
 * silently run words together.
 */
export function pdfFilename(destination, dayCount) {
  const place = String(destination || "trip")
    .split(",")[0]
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    // A colon or slash already collapsed to a space above, so without this
    // "San/Sebastian: Costa Rica" comes out with a doubled dash in the middle.
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "trip";
  const days = dayCount > 0 ? `-${dayCount}d` : "";
  return `${place}-itinerary${days}.pdf`;
}

/** Page numbers and the destination, on every page but the cover. */
function drawFooters(doc, { destination, totalPages }) {
  const label = String(destination || "").split(",")[0].trim();

  for (let page = 2; page <= totalPages; page += 1) {
    doc.setPage(page);

    doc.setDrawColor(...COLOR.border);
    doc.setLineWidth(0.2);
    doc.line(PAGE.margin, PAGE.height - PAGE.margin + 2, PAGE.width - PAGE.margin, PAGE.height - PAGE.margin + 2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE.labelPt);
    doc.setTextColor(...COLOR.muted);
    if (label) doc.text(label, PAGE.margin, PAGE.height - PAGE.margin + 6);
    doc.text(`${page} / ${totalPages}`, PAGE.width - PAGE.margin, PAGE.height - PAGE.margin + 6, {
      align: "right",
    });
  }
}

/**
 * Builds the document and hands it to the caller.
 *
 * `onProgress(done, total, label)` is called as images arrive so the button can
 * report something honest. The callback is optional and its absence changes
 * nothing about the output.
 *
 * @returns {Promise<{doc: import('jspdf').jsPDF, filename: string, skipped: number}>}
 */
export async function buildItineraryPdf({
  trip,
  plan,
  members = [],
  destination,
  onProgress,
} = {}) {
  const assets = collectAssets({ trip, plan, members });
  const { days, photoSlots, mapUrls, viewports } = assets;
  const totalImages = assets.photoUrls.length + mapUrls.filter(Boolean).length;

  // 1. Everything remote, fetched once, before a single page exists.
  let done = 0;
  const tick = (label) => onProgress?.(++done, totalImages, label);

  const photos = await loadImages(assets.photoUrls, {
    concurrency: 6,
    maxPx: PHOTO.targetPx,
    quality: PHOTO.quality,
    onProgress: () => tick("photos"),
  });

  const maps = [];
  for (const [index, url] of mapUrls.entries()) {
    if (!url) {
      maps.push(null);
      tick("map");
      continue;
    }
    const raw = await loadImageDataUrl(url, {
      maxPx: MAP_PX.width * 2,
      quality: 0.82,
    });
    tick("map");
    maps.push(raw ? await annotateMap(raw, {
      points: stopPoints(days[index]?.stops),
      viewport: viewports[index],
      widthPx: MAP_PX.width,
      heightPx: MAP_PX.height,
    }) : null);
  }

  // Positional photos per day, so a day section can index its own stops.
  const photosByDay = groupPhotosByDay(photoSlots, photos);

  const skipped = photos.filter((p) => !p).length + maps.filter((m) => !m).length;

  // 2. Draw.
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({
    title: `${String(destination || "Trip").split(",")[0].trim()} itinerary`,
    subject: "Trip itinerary",
    creator: "Tripder",
  });

  const flow = new Flow(doc);

  drawCover(doc, flow, {
    trip,
    plan,
    members,
    destination,
    confirmedAt: plan?.confirmed_at,
    confirmedBy: plan?.confirmed_by,
  });

  drawStory(doc, flow, {
    groupProfile: plan?.group_profile,
    rationale: plan?.rationale,
  });

  days.forEach((day, index) => {
    drawDay(doc, flow, {
      day,
      mapImage: maps[index] || null,
      photos: photosByDay.get(day) || [],
      // The per-day rationale is a string keyed by day_index on the plan.
      rationale: plan?.rationale?.days?.[String(day.day_index)],
    });
  });

  // 3. Footers, now that the page count is final.
  drawFooters(doc, {
    destination,
    totalPages: doc.internal.getNumberOfPages(),
  });

  return {
    doc,
    filename: pdfFilename(destination, days.length),
    skipped,
  };
}