/**
 * "Why this plan" -- the page that makes the document ours rather than a
 * generic list of places.
 *
 * This is the one page whose content is entirely group-shaped: what the group
 * agreed on, where it split and how that was settled, and the constraints the
 * plan was built around. The plan screen shows the same material behind a tab;
 * here it is the second thing a reader sees, because "why are we going to this
 * obscure museum" is the question an itinerary invites and a bare schedule
 * cannot answer.
 *
 * Everything here is optional. A group whose swipes all pointed the same way
 * has no conflicts and no constraints, and an empty section is worse than no
 * section -- the page simply does not appear.
 */

import { COLOR, SPACE, TYPE } from "../theme.js";
import { wrapText } from "../flow.js";
import { CATEGORY_LABELS } from "../../preferenceProfile.js";

const LINE = 3.6;
const GAP_AFTER_BLOCK = SPACE.md;

const asList = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

/**
 * Whether there is enough here to justify the page.
 *
 * Exported because both the page and its tests need the same answer, and
 * deciding it twice is how a blank page gets shipped.
 */
export function hasStory(groupProfile, rationale) {
  if (asList(rationale?.summary).length) return true;
  if (asList(groupProfile?.group_priorities).length) return true;
  if (asList(groupProfile?.group_conflicts).length) return true;
  if (asList(groupProfile?.hard_constraints).length) return true;
  return Boolean(groupProfile?.recommended_balance && Object.keys(groupProfile.recommended_balance).length);
}

/** Section heading with a gold tick, used by every block on the page. */
function drawBlockTitle(doc, flow, text) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE.bodyPt);
  doc.setTextColor(...COLOR.ink);

  const y = flow.y + LINE;
  doc.text(text, flow.left + 5, y);

  doc.setDrawColor(...COLOR.accent);
  doc.setLineWidth(0.5);
  doc.line(flow.left, y - 1.4, flow.left + 2.6, y - 1.4);

  flow.advance(LINE + SPACE.xs);
}

function drawParagraph(doc, flow, text, { maxLines = 4, style = "normal" } = {}) {
  const { lines } = wrapText(doc, text, {
    width: flow.contentWidth - 5,
    fontSize: TYPE.captionPt,
    maxLines,
  });
  doc.setFont("helvetica", style);
  doc.setFontSize(TYPE.captionPt);
  doc.setTextColor(...COLOR.muted);
  for (const line of lines) {
    doc.text(line, flow.left + 5, flow.y + LINE);
    flow.advance(LINE);
  }
  if (lines.length) flow.advance(SPACE.xs);
  return lines.length;
}

function drawBullets(doc, flow, items) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(TYPE.captionPt);
  for (const item of items) {
    const { lines } = wrapText(doc, `·  ${item}`, {
      width: flow.contentWidth - 10,
      fontSize: TYPE.captionPt,
      maxLines: 2,
    });
    doc.setTextColor(...COLOR.muted);
    for (const line of lines) {
      doc.text(line, flow.left + 8, flow.y + LINE);
      flow.advance(LINE);
    }
    flow.advance(0.6);
  }
}

/** One conflict: the topic, the two sides, and how it was settled. */
function drawConflict(doc, flow, conflict) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE.captionPt);
  doc.setTextColor(...COLOR.ink);
  doc.text(String(conflict?.topic || "A disagreement"), flow.left + 8, flow.y + LINE);
  flow.advance(LINE);

  const sides = [asList(conflict?.members_a).join(", "), asList(conflict?.members_b).join(", ")]
    .filter(Boolean)
    .join("  vs  ");
  if (sides) drawParagraph(doc, flow, sides, { maxLines: 2 });
  if (conflict?.resolution) {
    drawParagraph(doc, flow, `Settled on: ${conflict.resolution}`, { maxLines: 3, style: "italic" });
  }
  flow.advance(SPACE.xs);
}

/**
 * The category balance, as a row of small bars.
 *
 * Drawn rather than listed because the point of the balance is the ratio: three
 * "high" bars and one "low" say it faster than four sentences.
 */
function drawBalance(doc, flow, balance) {
  const levels = { high: 1, medium: 0.6, low: 0.28 };
  const trackWidth = flow.contentWidth - 44;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(TYPE.captionPt);

  for (const [category, level] of Object.entries(balance)) {
    const label = CATEGORY_LABELS[category] || category;
    const y = flow.y + LINE;

    doc.setTextColor(...COLOR.ink);
    doc.text(label, flow.left + 5, y);

    const barLeft = flow.left + 38;
    doc.setFillColor(...COLOR.surface);
    doc.rect(barLeft, y - 2.4, trackWidth, 2.4, "F");
    doc.setFillColor(...COLOR.accent);
    doc.rect(barLeft, y - 2.4, Math.max(2, trackWidth * (levels[level] ?? 0.6)), 2.4, "F");

    doc.setTextColor(...COLOR.muted);
    doc.text(String(level), flow.left + 38 + trackWidth + 4, y);

    flow.advance(LINE + 1.2);
  }
  flow.advance(SPACE.xs);
}

/**
 * Draws the story page on its own page, and only if there is a story.
 *
 * Returns whether a page was added, so the caller knows whether the page
 * numbers on the cover need to move.
 */
export function drawStory(doc, flow, { groupProfile, rationale }) {
  if (!hasStory(groupProfile, rationale)) return false;

  flow.newPage();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE.titlePt);
  doc.setTextColor(...COLOR.ink);
  doc.text("Why this plan", flow.left, flow.y + 5);
  flow.advance(TYPE.titlePt * 0.5 + SPACE.sm);

  const summary = asList(rationale?.summary);
  if (summary.length) {
    drawParagraph(doc, flow, summary.join(" "), { maxLines: 6 });
    flow.advance(SPACE.xs);
  }

  if (asList(groupProfile?.group_priorities).length) {
    drawBlockTitle(doc, flow, "What the group agrees on");
    drawBullets(doc, flow, groupProfile.group_priorities);
    flow.advance(GAP_AFTER_BLOCK);
  }

  if (groupProfile?.recommended_balance && Object.keys(groupProfile.recommended_balance).length) {
    drawBlockTitle(doc, flow, "Balance");
    drawBalance(doc, flow, groupProfile.recommended_balance);
    flow.advance(GAP_AFTER_BLOCK);
  }

  if (asList(groupProfile?.group_conflicts).length) {
    drawBlockTitle(doc, flow, "Where the group split");
    for (const conflict of groupProfile.group_conflicts) {
      drawConflict(doc, flow, conflict);
    }
    flow.advance(GAP_AFTER_BLOCK);
  }

  if (asList(groupProfile?.hard_constraints).length) {
    drawBlockTitle(doc, flow, "Constraints we planned around");
    drawBullets(doc, flow, groupProfile.hard_constraints);
    flow.advance(GAP_AFTER_BLOCK);
  }

  return true;
}