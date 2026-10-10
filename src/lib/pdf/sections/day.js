/**
 * One day: heading, the day's map, then its stops.
 *
 * Each day owns a page. That costs a few sheets on a long trip and buys a
 * document that survives being printed, folded and read on a train: a day is
 * self-contained, the map sits with the stops it belongs to, and nothing a
 * reader wants is split away from the page it belongs to.
 */

import { COLOR, MAP, PHOTO, SPACE, TYPE } from "../theme.js";
import { wrapText } from "../flow.js";
import { drawStop, drawLeg } from "./stop.js";
import { parseTripDate } from "../../../utils/date.js";

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const LINE_AFTER_SUBTITLE = 4.6;
const LINE_RATIONALE = 3.4;

/**
 * `06.05 Tue`, matching the plan screen. Falls back to the ordinal when the day
 * has no date, because a day number is still useful and an empty heading is not.
 */
export function dayHeading(day) {
  const date = parseTripDate(day?.date);
  if (!date) return `Day ${(day?.day_index ?? 0) + 1}`;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${month}.${dayOfMonth} ${DAYS_SHORT[date.getDay()]}`;
}

const MODE_LABEL = { walking: "On foot", driving: "By car" };

/** `09:00 – 19:00 · On foot`, with the parts that are missing dropped. */
export function daySubtitle(day) {
  const parts = [];
  if (day?.startTime || day?.endTime) {
    parts.push(day.endTime ? `${day.startTime || "?"} – ${day.endTime}` : day.startTime);
  }
  const mode = MODE_LABEL[day?.transport_mode];
  if (mode) parts.push(mode);
  if (day?.overflow) parts.push("Runs late");
  return parts.join("   ·   ");
}

/**
 * The day's map, or nothing.
 *
 * Returning the height it would occupy even when the image is missing lets the
 * caller lay out below it without branching; the alternative is a day section
 * that behaves differently depending on whether Mapbox answered.
 */
function drawMap(doc, flow, mapImage) {
  if (!mapImage) return 0;
  flow.ensureBlock(MAP.height);
  const top = flow.y;
  doc.addImage(mapImage, "JPEG", flow.left, top, MAP.width, MAP.height, undefined, "FAST");
  flow.advance(MAP.height + SPACE.md);
  return MAP.height + SPACE.md;
}

/**
 * Draws a whole day onto the current page, starting a new one first.
 *
 * `photos` is positional: index 0 is the first stop. A null there means the
 * photo failed to load and the block falls back to text.
 */
export function drawDay(doc, flow, { day, mapImage, photos, rationale }) {
  if (!day) return;

  flow.newPage();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE.titlePt);
  doc.setTextColor(...COLOR.ink);
  doc.text(dayHeading(day), flow.left, flow.y + 5);
  flow.advance(TYPE.titlePt * 0.42 + SPACE.xs);

  // A short gold rule above the heading: the one place in the document where
  // the accent is a solid, because it is the one thing that has to be found at
  // a glance when flipping the pages. Drawn after the heading is placed, and
  // above its ascender, or it strikes through the text.
  doc.setFillColor(...COLOR.accent);
  doc.rect(flow.left, flow.y - 1, 18, 1.6, "F");
  flow.advance(SPACE.md);

  const subtitle = daySubtitle(day);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE.captionPt);
    doc.setTextColor(...COLOR.muted);
    doc.text(subtitle, flow.left, flow.y);
    flow.advance(LINE_AFTER_SUBTITLE);
  }

  if (rationale) {
    const lines = wrapText(doc, rationale, {
      width: flow.contentWidth,
      fontSize: TYPE.captionPt,
      maxLines: 3,
      style: "italic",
    });
    if (lines.lines.length) {
      doc.setTextColor(...COLOR.ink);
      for (const line of lines.lines) {
        doc.text(line, flow.left, flow.y);
        flow.advance(LINE_RATIONALE);
      }
      flow.advance(SPACE.xs);
    }
  }

  flow.advance(SPACE.sm);
  drawMap(doc, flow, mapImage);

  const stops = Array.isArray(day.stops) ? day.stops : [];
  // Sized from the theme, and capped at a fifth of the column so a very wide
  // page (or a future landscape layout) cannot produce a photo taller than the
  // text block beside it.
  const photoWidth = Math.min(PHOTO.size, flow.contentWidth * 0.2);

  stops.forEach((stop, index) => {
    if (index > 0) drawLeg(doc, flow, stop.leg);
    drawStop(doc, flow, {
      stop,
      index,
      photo: photos?.[index] || null,
      photoWidth,
    });
  });

  if (!stops.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE.captionPt);
    doc.setTextColor(...COLOR.muted);
    doc.text("No stops on this day.", flow.left, flow.y);
    flow.advance(4);
  }
}