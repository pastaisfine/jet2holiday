/**
 * Vertical layout for a paginated document.
 *
 * jsPDF has no layout engine: you place every element at an absolute position
 * and it will happily draw it off the bottom of the page. Every section in this
 * module therefore writes top-down through a Flow, which tracks the cursor and
 * decides when the next thing no longer fits.
 *
 * The rule this encodes is the one that makes the output usable: a stop block,
 * a day heading or a paragraph never splits across pages. Flow breaks *before*
 * an element that will not fit whole, which costs some white space at the foot
 * of a page and buys a document where no stop is cut in half.
 *
 * Flow talks to jsPDF through three calls -- getHeight(), addPage() and the
 * page number -- rather than holding a document, so it can be driven by a stub
 * in tests. The break arithmetic is the part worth testing; jsPDF's own text
 * measurement is not.
 */

import { PAGE } from "./theme.js";

/**
 * Space reserved below the last drawn element before a break is considered, and
 * above a page footer. Symmetric so page bottoms and page tops carry the same
 * optical margin.
 */
const FOOTER_SPACE = 10;

export class Flow {
  /**
   * @param {object} doc a jsPDF document (or anything with internal.pageSize,
   *   addPage() and internal.getNumberOfPages())
   * @param {{margin?: number, startAt?: number}} [options]
   */
  constructor(doc, { margin = PAGE.margin, startAt } = {}) {
    this.doc = doc;
    this.margin = margin;
    this.top = margin;
    this.bottom = doc.internal.pageSize.getHeight() - margin - FOOTER_SPACE;
    this.y = startAt ?? this.top;
  }

  get contentWidth() {
    return this.doc.internal.pageSize.getWidth() - this.margin * 2;
  }

  get remaining() {
    return this.bottom - this.y;
  }

  /** Breaks to a new page if `height` will not fit, and always lands on the top margin. */
  ensure(height) {
    if (this.remaining >= height) return false;
    this.doc.addPage();
    this.y = this.top;
    return true;
  }

  /**
   * Breaks only if the element would not fit *and* something has already been
   * drawn on this page. A block taller than a whole page starts at the top
   * rather than looping forever against `ensure`.
   */
  ensureBlock(height) {
    if (this.remaining >= height) return false;
    if (this.y <= this.top) return false;
    this.doc.addPage();
    this.y = this.top;
    return true;
  }

  advance(amount) {
    this.y += amount;
    return this.y;
  }

  /** Always breaks when asked, for sections that own a page. */
  newPage() {
    this.doc.addPage();
    this.y = this.top;
  }

  pageNumber() {
    return this.doc.internal.getNumberOfPages();
  }

  get left() {
    return this.margin;
  }

  get right() {
    return this.margin + this.contentWidth;
  }
}

/**
 * Lines jsPDF can actually draw, capped at `maxLines`.
 *
 * Two jobs beyond wrapping. The cap stops one chatty description from eating a
 * page, and it lets the return value carry whether anything was dropped so the
 * caller can print an ellipsis and stay honest about it rather than silently
 * truncating.
 */
export function wrapText(doc, text, { width, fontSize, maxLines = Infinity, style } = {}) {
  const value = String(text ?? "").trim();
  if (!value) return { lines: [], truncated: false };
  if (style) doc.setFont(undefined, style);

  let lines = doc.splitTextToSize(value, width) || [];
  const truncated = lines.length > maxLines;
  if (truncated) {
    lines = lines.slice(0, maxLines);
    const last = lines.length - 1;
    lines[last] = `${lines[last].replace(/[\s,.;:—-]+$/, "")}…`;
  }
  return { lines, truncated, fontSize };
}

/** Height a wrapped block will occupy, given its line height. */
export function textHeight(lineCount, lineHeight) {
  return lineCount * lineHeight;
}