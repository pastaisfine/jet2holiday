/**
 * One stop: the photo, the number, the times, the address, the description.
 *
 * The stop block is the reason the PDF exists, and it is also the part that has
 * to survive bad data, because the plan keeps changing after confirmation --
 * members vote suggestions through, so a stop can arrive with a missing photo,
 * a missing coordinate or a blank description. Every field here is optional and
 * the block simply gets shorter.
 */

import { COLOR, SPACE, TYPE } from "../theme.js";
import { wrapText } from "../flow.js";
import { CATEGORY_LABELS } from "../../preferenceProfile.js";

const LINE = {
  name: 4.2,
  meta: 3.4,
  body: 3.6,
  tight: 3,
};

/** Reused across stops so one call does not re-wrap every description. */
const categoryLabel = (category) => CATEGORY_LABELS[category] || "Attractions";

/** `09:00 – 10:30`, or just the start when the scheduler gave no end. */
export function timeRange(stop) {
  if (!stop?.t) return "";
  if (!stop?.end) return stop.t;
  return `${stop.t} – ${stop.end}`;
}

/**
 * A one-line summary of a stop: category, rating, area. Parts are dropped as
 * they go missing rather than leaving stray separators behind.
 */
export function stopMeta(stop) {
  const parts = [];
  if (stop?.category) parts.push(categoryLabel(stop.category));
  if (typeof stop?.rating === "number" && stop.rating > 0) {
    parts.push(`★ ${Number(stop.rating).toFixed(1)}`);
  }
  if (stop?.area) parts.push(stop.area);
  return parts.join("  ·  ");
}

/** Latitude and longitude at five decimals, which is a few centimetres. */
export function coordinates(stop) {
  if (typeof stop?.lat !== "number" || typeof stop?.lng !== "number") return "";
  return `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}`;
}

/** The travel leg departing this stop, as a caption between blocks. */
export function legLabel(leg) {
  if (!leg || leg.distanceMeters <= 0) return "";
  const distance =
    leg.distanceMeters >= 1000
      ? `${(leg.distanceMeters / 1000).toFixed(1)} km`
      : `${Math.round(leg.distanceMeters)} m`;
  if (!(leg.durationMin > 0)) return distance;
  return `${distance} · ${Math.round(leg.durationMin)} min`;
}

/**
 * Measures a stop block without drawing it.
 *
 * Flow needs the height before it can decide whether the block survives on
 * this page, and jsPDF will not tell you a block's height without doing the
 * text layout that produces it. Measuring and drawing the same lines keeps the
 * two in agreement; the alternative -- drawing optimistically and correcting
 * afterwards -- splits blocks across pages, which is the thing Flow exists to
 * prevent.
 */
function measureStop(doc, { stop, textWidth, hasPhoto, photoWidth }) {
  const meta = stopMeta(stop);
  const description = wrapText(doc, stop?.description, {
    width: textWidth,
    fontSize: TYPE.captionPt,
    maxLines: 3,
  });
  const coords = coordinates(stop);

  let height = LINE.name;
  if (meta) height += LINE.meta;
  if (stop?.why) height += LINE.meta;
  if (description.lines.length) height += description.lines.length * LINE.body + SPACE.xs;
  if (coords) height += LINE.tight;

  // Only a stop that actually has a photo is floored at the photo's height.
  // Flooring unconditionally reserved a square of white for every text-only
  // stop, which spread a three-stop day down half a page.
  return hasPhoto ? Math.max(height, photoWidth) : height;
}

/**
 * Draws one stop. Returns the height consumed.
 *
 * `photo` is a data URL or null; the block lays out to its text when the photo
 * is missing rather than reserving an empty square, so a trip with no photos
 * is a clean list instead of a list of holes.
 */
export function drawStop(doc, flow, { stop, index, photo, photoWidth }) {
  const textLeft = flow.left + (photo ? photoWidth + SPACE.md : 0);
  const textWidth = flow.right - textLeft;
  const height = measureStop(doc, { stop, textWidth, hasPhoto: Boolean(photo), photoWidth });

  // A block that cannot fit whole moves to the next page rather than splitting.
  flow.ensureBlock(height);
  const top = flow.y;

  if (photo) {
    // The deck stores square thumbnails, so a square box needs no cropping and
    // no aspect correction; addImage is given both dimensions explicitly
    // because otherwise jsPDF scales by the image's own pixel size.
    doc.addImage(photo, "JPEG", flow.left, top, photoWidth, photoWidth, undefined, "FAST");
  }

  let cursor = top + LINE.name;

  doc.setTextColor(...COLOR.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE.bodyPt);
  doc.text(`${index + 1}. ${stop?.name || "Untitled stop"}`, textLeft, cursor);

  cursor += LINE.meta;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(TYPE.captionPt);

  const times = timeRange(stop);
  const meta = stopMeta(stop);
  const header = [times, meta].filter(Boolean).join("   ");
  if (header) {
    doc.setTextColor(...COLOR.muted);
    doc.text(header, textLeft, cursor);
    cursor += LINE.meta;
  }

  if (stop?.why) {
    const why = wrapText(doc, stop.why, { width: textWidth, fontSize: TYPE.captionPt, maxLines: 2, style: "italic" });
    doc.setTextColor(...COLOR.ink);
    for (const line of why.lines) {
      doc.text(line, textLeft, cursor);
      cursor += LINE.body;
    }
    cursor += SPACE.xs;
  }

  const description = wrapText(doc, stop?.description, {
    width: textWidth,
    fontSize: TYPE.captionPt,
    maxLines: 3,
  });
  if (description.lines.length) {
    doc.setTextColor(...COLOR.muted);
    for (const line of description.lines) {
      doc.text(line, textLeft, cursor);
      cursor += LINE.body;
    }
    cursor += SPACE.xs;
  }

  const coords = coordinates(stop);
  if (coords) {
    doc.setTextColor(...COLOR.muted);
    doc.setFontSize(TYPE.labelPt);
    doc.text(coords, textLeft, cursor);
    cursor += LINE.tight;
  }

  flow.y = Math.max(cursor, top + height) + SPACE.lg;
  return flow.y - top;
}

/**
 * The travel leg between two stops, as a centred caption.
 *
 * Drawn on its own so it can be skipped entirely when routing produced nothing,
 * rather than leaving an orphaned arrow between blocks.
 */
export function drawLeg(doc, flow, leg) {
  const label = legLabel(leg);
  if (!label) return 0;

  const height = LINE.meta + SPACE.sm;
  if (flow.remaining < height) return 0;

  const y = flow.y;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(TYPE.labelPt);
  doc.setTextColor(...COLOR.muted);
  doc.text(`— ${label} —`, flow.left + flow.contentWidth / 2, y, { align: "center" });

  flow.advance(height);
  return height;
}