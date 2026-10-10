/**
 * The cover: where, when, who, and the fact that the group agreed on this.
 *
 * A trip itinerary handed to someone who is not in the group has to answer
 * three questions before anything else: where, when, and who am I reading this
 * with. Everything after this page assumes they have been answered.
 */

import { COLOR, PAGE, SPACE, TYPE } from "../theme.js";
import { wrapText } from "../flow.js";
import { parseTripDate } from "../../../utils/date.js";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const LINE_AFTER_CREW = 4.6;

/** `June 5 – 12, 2026`, or the range the trip actually holds. */
export function coverDates(trip) {
  const start = parseTripDate(trip?.start_date);
  const end = parseTripDate(trip?.end_date);
  if (start && end) {
    const year = start.getFullYear();
    if (start.getMonth() === end.getMonth()) {
      return `${MONTHS[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${year}`;
    }
    return `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${year}`;
  }
  if (start) return `${MONTHS[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()}`;
  // No dates on the trip row: the plan's own day count is better than nothing.
  if (typeof trip?.dayCount === "number" && trip.dayCount > 0) {
    return `${trip.dayCount} day${trip.dayCount === 1 ? "" : "s"}`;
  }
  return "";
}

/**
 * One name per traveller, de-duplicated, in join order.
 *
 * `username` is what the membership rows actually carry; the other two names
 * are here so this stays usable from anywhere that has a richer profile shape
 * without silently printing a column of blanks.
 */
export function crewNames(members) {
  const seen = new Set();
  const names = [];
  for (const member of members || []) {
    const name = String(member?.username || member?.displayName || member?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** `Paris, France` -> `Paris`, matching the rest of the app's headings. */
export function shortDestination(destination) {
  return String(destination || "Your trip").split(",")[0].trim() || "Your trip";
}

/**
 * Draws the cover onto page one. The cursor is left where it started, because
 * the day sections each claim their own page and the footer pass draws last.
 */
export function drawCover(doc, flow, { trip, plan, members, destination, confirmedAt, confirmedBy }) {
  const left = flow.left;
  const width = flow.contentWidth;
  let y = flow.y + 26;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(TYPE.labelPt);
  doc.setTextColor(...COLOR.muted);
  doc.text("TRIP ITINERARY", left, y);
  y += SPACE.lg;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE.displayPt);
  doc.setTextColor(...COLOR.ink);
  const place = shortDestination(destination);
  const placeLines = wrapText(doc, place, {
    width,
    fontSize: TYPE.displayPt,
    maxLines: 2,
  });
  for (const line of placeLines.lines) {
    doc.text(line, left, y);
    y += TYPE.displayPt * 0.42;
  }
  y += SPACE.xs;

  const dates = coverDates(trip);
  if (dates) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE.titlePt);
    doc.setTextColor(...COLOR.muted);
    doc.text(dates, left, y);
    y += TYPE.titlePt * 0.5 + SPACE.lg;
  }

  doc.setFillColor(...COLOR.accent);
  doc.rect(left, y, 42, 1.4, "F");
  y += SPACE.lg;

  const dayCount = Array.isArray(plan?.validated_plan?.days)
    ? plan.validated_plan.days.length
    : 0;
  if (dayCount > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE.bodyPt);
    doc.setTextColor(...COLOR.ink);
    doc.text(
      `${dayCount} day${dayCount === 1 ? "" : "s"} · ${place}`,
      left,
      y,
    );
    y += SPACE.md;
  }

  const crew = crewNames(members);
  if (crew.length) {
    doc.setFontSize(TYPE.captionPt);
    doc.setTextColor(...COLOR.muted);
    const lines = wrapText(doc, crew.join("  ·  "), {
      width,
      fontSize: TYPE.captionPt,
      maxLines: 3,
    });
    doc.text(lines.lines[0] || "", left, y);
    y += LINE_AFTER_CREW;
  }

  if (confirmedBy || confirmedAt) {
    const when = confirmedAt ? formatConfirmed(confirmedAt) : "";
    const credit = [confirmedBy, when].filter(Boolean).join(" · ");
    if (credit) {
      doc.setFontSize(TYPE.captionPt);
      doc.setTextColor(...COLOR.muted);
      doc.text(`Confirmed by ${credit}`, left, PAGE.height - PAGE.margin - 6);
    }
  }

  flow.y = flow.top;
}


/** A plain date for the cover; the ISO string is never shown raw. */
function formatConfirmed(value) {
  const date = parseTripDate(value);
  if (!date) return "";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}