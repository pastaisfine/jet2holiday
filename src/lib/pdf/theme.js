/**
 * Print geometry and palette for the itinerary PDF.
 *
 * jsPDF works in two units at once and mixing them up is the easiest way to
 * produce a document that looks broken: coordinates are in the document unit
 * (millimetres, since that is what `new jsPDF()` defaults to) while font sizes
 * are always points. Every number in this file is millimetres unless its name
 * ends in `Pt`.
 *
 * The palette is derived from the app's design tokens rather than invented for
 * print. src/index.css speaks oklch and jsPDF has no oklch, so each colour is
 * the token converted to 8-bit sRGB. Keeping the source token next to the
 * result is the point: when the brand moves, this file is where the diff shows
 * up. Recompute with the same oklch -> oklab -> linear sRGB -> sRGB transfer
 * the tokens imply, not by eyeballing a hex picker.
 *
 *   --fg       oklch(19.54% 0.0182 137.9)  ->  [17, 23, 15]
 *   --muted    oklch(49.83% 0.0184 154.1)  ->  [91, 102, 94]
 *   --border   oklch(90.54% 0.0172 145.4)  ->  [217, 227, 217]
 *   --surface  oklch(98.94% 0.0119 101.5)  ->  [253, 252, 243]
 *   --accent   oklch(76.19% 0.1405 98.4)   ->  [201, 178, 53]
 *
 * Checked against: `scripts/check-colors.mjs` scans *.css and literals inside
 * `style={{}}` props only, so a colour constant in a .js file is not gated by
 * it. That is a gap in the guard, not permission -- these live here precisely
 * so there is one place to look when the brand changes.
 */

export const COLOR = {
  /** Body copy and headings. --fg */
  ink: [17, 23, 15],
  /** Secondary copy: areas, times, captions. --muted */
  muted: [91, 102, 94],
  /** Rules and card outlines. --border */
  border: [217, 227, 217],
  /** Tinted card fills. --surface */
  surface: [253, 252, 243],
  /** The gold. Day numbers, the cover rule, the confirm mark. --accent */
  accent: [201, 178, 53],
  /** Accent used as a background, where --accent is too light to read on. --accent-deep */
  accentDeep: [177, 152, 0],
  /** Page background and reversed-out text. --bg */
  paper: [255, 255, 255],
};

/** A4 portrait, in millimetres. */
export const PAGE = {
  width: 210,
  height: 297,
  margin: 16,
  get contentWidth() {
    return this.width - this.margin * 2;
  },
};

/**
 * Type scale in points. Four steps is the whole document: a display size for
 * the cover, a section size for day headings, a body size for stop names, and a
 * caption size for everything that is supporting detail. A fifth step is how
 * documents start looking accidental.
 */
export const TYPE = {
  displayPt: 26,
  titlePt: 15,
  bodyPt: 10.5,
  captionPt: 8.5,
  labelPt: 7,
};

/** Spacing steps, millimetres. */
export const SPACE = {
  xs: 1.5,
  sm: 3,
  md: 6,
  lg: 10,
};

/**
 * Stop photo box. Square, because deck thumbnails are square (1000x1000 on
 * disk) and cropping them to a letterbox would either crop the subject or
 * letterbox inside the frame anyway.
 */
export const PHOTO = {
  size: 26,
  radius: 2,
  /**
   * Card photos are 1000x1000 and around 400 KB each; a five-day trip is
   * roughly twelve megabytes of raw JPEG. Downscale on the way in
   * (see assets.js) so the embedded copy is print-sized rather than print-sized
   * *by accident*.
   */
  targetPx: 600,
  quality: 0.7,
};

/** Map image per day, millimetres. */
export const MAP = {
  width: PAGE.contentWidth,
  height: 58,
  radius: 2,
  overlayPad: 0.14,
  /** Below this many coordinates the route is a dot, not a line. */
  minPoints: 2,
};