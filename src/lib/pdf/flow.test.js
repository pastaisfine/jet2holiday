import { describe, it, expect, vi } from "vitest";
import { Flow, wrapText, textHeight } from "./flow.js";

/** A jsPDF stand-in: pages are a known size and we count the breaks. */
function fakeDoc({ width = 210, height = 297 } = {}) {
  let pages = 1;
  return {
    pages: () => pages,
    addPage: vi.fn(() => {
      pages += 1;
    }),
    internal: {
      pageSize: { getWidth: () => width, getHeight: () => height },
      getNumberOfPages: () => pages,
    },
    splitTextToSize: (text, w) => {
      const chars = Math.max(1, Math.floor(w / 4));
      const words = text.split(/\s+/);
      const lines = [];
      let line = "";
      for (const word of words) {
        if ((line + " " + word).trim().length > chars) {
          lines.push(line.trim());
          line = word;
        } else {
          line = `${line} ${word}`;
        }
      }
      if (line.trim()) lines.push(line.trim());
      return lines;
    },
  };
}

describe("Flow", () => {
  it("starts at the top margin and knows its usable width", () => {
    const flow = new Flow(fakeDoc(), { margin: 16 });
    expect(flow.y).toBe(16);
    expect(flow.contentWidth).toBe(210 - 32);
    expect(flow.left).toBe(16);
    expect(flow.right).toBe(194);
  });

  it("does not break when the element fits", () => {
    const doc = fakeDoc();
    const flow = new Flow(doc);
    expect(flow.ensure(20)).toBe(false);
    expect(doc.addPage).not.toHaveBeenCalled();
  });

  it("breaks and returns to the top margin when the element does not fit", () => {
    const doc = fakeDoc();
    const flow = new Flow(doc);
    flow.y = flow.bottom - 4;
    expect(flow.ensure(20)).toBe(true);
    expect(doc.addPage).toHaveBeenCalledTimes(1);
    expect(flow.y).toBe(flow.top);
  });

  it("reserves a footer band so nothing lands in the bottom margin", () => {
    const flow = new Flow(fakeDoc({ height: 297 }), { margin: 16 });
    // 297 - 16 margin - 10 footer.
    expect(flow.bottom).toBe(271);
  });

  it("tracks remaining space as it advances", () => {
    const flow = new Flow(fakeDoc());
    const before = flow.remaining;
    flow.advance(12);
    expect(flow.remaining).toBeCloseTo(before - 12, 6);
  });

  describe("ensureBlock", () => {
    it("refuses to loop when a block is taller than a whole page", () => {
      const doc = fakeDoc();
      const flow = new Flow(doc);
      // Sitting at the top already: there is nowhere to break to.
      expect(flow.ensureBlock(10_000)).toBe(false);
      expect(doc.addPage).not.toHaveBeenCalled();
    });

    it("still breaks mid-page for an oversized block", () => {
      const doc = fakeDoc();
      const flow = new Flow(doc);
      flow.advance(50);
      expect(flow.ensureBlock(10_000)).toBe(true);
      expect(flow.y).toBe(flow.top);
    });
  });

  it("newPage always starts a fresh page", () => {
    const doc = fakeDoc();
    const flow = new Flow(doc);
    flow.advance(40);
    flow.newPage();
    expect(doc.addPage).toHaveBeenCalledTimes(1);
    expect(flow.y).toBe(flow.top);
  });

  it("reports the running page number for footers", () => {
    const doc = fakeDoc();
    const flow = new Flow(doc);
    expect(flow.pageNumber()).toBe(1);
    flow.newPage();
    expect(flow.pageNumber()).toBe(2);
  });

  it("never lets the cursor sit above the top margin", () => {
    const flow = new Flow(fakeDoc());
    flow.advance(-100);
    flow.newPage();
    expect(flow.y).toBe(flow.top);
  });
});

describe("wrapText", () => {
  it("returns nothing for empty input", () => {
    const doc = fakeDoc();
    expect(wrapText(doc, "", { width: 100 }).lines).toEqual([]);
    expect(wrapText(doc, null, { width: 100 }).lines).toEqual([]);
    expect(wrapText(doc, "   ", { width: 100 }).lines).toEqual([]);
  });

  it("wraps and reports no truncation when it fits", () => {
    const doc = fakeDoc();
    const { lines, truncated } = wrapText(doc, "one two three four five six", { width: 100 });
    expect(lines.length).toBeGreaterThan(1);
    expect(truncated).toBe(false);
  });

  it("caps at maxLines and says so", () => {
    const doc = fakeDoc();
    const { lines, truncated } = wrapText(
      doc,
      "one two three four five six seven eight nine ten eleven twelve",
      { width: 100, maxLines: 2 },
    );
    expect(lines).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it("marks the cut with an ellipsis rather than a bare truncation", () => {
    const doc = fakeDoc();
    const { lines } = wrapText(doc, "alpha beta gamma delta epsilon zeta", {
      width: 100,
      maxLines: 1,
    });
    expect(lines[0].endsWith("…")).toBe(true);
  });
});

describe("textHeight", () => {
  it("multiplies lines by the line height", () => {
    expect(textHeight(3, 4)).toBe(12);
    expect(textHeight(0, 4)).toBe(0);
  });
});