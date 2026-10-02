import { describe, it, expect } from "vitest";
import {
  buildSwipedKeys,
  addSwipedKey,
  partitionDeck,
  isCardSwiped,
  normalizeDeckName,
} from "./swipeDeck";

const card = (id, name, extra = {}) => ({ id, name, ...extra });

describe("normalizeDeckName", () => {
  it("trims and lowercases", () => {
    expect(normalizeDeckName("  KLCC Park ")).toBe("klcc park");
    expect(normalizeDeckName(undefined)).toBe("");
  });
});

describe("buildSwipedKeys", () => {
  it("collects ids and normalised names from swipe rows", () => {
    const keys = buildSwipedKeys([
      { card_id: "gen-a", card_name: "KLCC Park" },
      { card_id: null, card_name: "Batu Caves" },
    ]);

    expect(keys.ids.has("gen-a")).toBe(true);
    expect(keys.names.has("klcc park")).toBe(true);
    expect(keys.names.has("batu caves")).toBe(true);
  });

  it("tolerates empty and malformed input", () => {
    expect(buildSwipedKeys().ids.size).toBe(0);
    expect(buildSwipedKeys([null, undefined, {}]).ids.size).toBe(0);
  });
});

describe("isCardSwiped", () => {
  const keys = buildSwipedKeys([{ card_id: "gen-a", card_name: "KLCC Park" }]);

  it("matches on card id", () => {
    expect(isCardSwiped(card("gen-a", "Somewhere else"), keys)).toBe(true);
  });

  it("falls back to the place name when a regenerated deck changed the id", () => {
    expect(isCardSwiped(card("gen-fresh-uuid", "KLCC Park"), keys)).toBe(true);
  });

  it("does not match a card the member never swiped", () => {
    expect(isCardSwiped(card("gen-b", "Batu Caves"), keys)).toBe(false);
  });
});

describe("addSwipedKey", () => {
  it("returns a new key set containing the card", () => {
    const before = buildSwipedKeys([]);
    const after = addSwipedKey(before, card("gen-a", "KLCC Park", { name: "KLCC Park" }));

    expect(before.ids.size).toBe(0);
    expect(after.ids.has("gen-a")).toBe(true);
    expect(after.names.has("klcc park")).toBe(true);
  });
});

describe("partitionDeck", () => {
  const deck = [
    card("gen-a", "KLCC Park"),
    card("gen-b", "Batu Caves"),
    card("gen-c", "Petronas Towers"),
  ];

  it("returns the whole deck when nothing has been swiped", () => {
    const { unswiped, swipedCount } = partitionDeck(deck, buildSwipedKeys([]));
    expect(unswiped).toHaveLength(3);
    expect(swipedCount).toBe(0);
  });

  it("removes swiped cards and counts them within the deck", () => {
    const keys = buildSwipedKeys([{ card_id: "gen-b", card_name: "Batu Caves" }]);
    const { unswiped, swipedCount } = partitionDeck(deck, keys);

    expect(unswiped.map((c) => c.id)).toEqual(["gen-a", "gen-c"]);
    expect(swipedCount).toBe(1);
  });

  it("returns an empty deck when everything is swiped", () => {
    const keys = buildSwipedKeys(deck.map((c) => ({ card_id: c.id, card_name: c.name })));
    const { unswiped, swipedCount } = partitionDeck(deck, keys);

    expect(unswiped).toHaveLength(0);
    expect(swipedCount).toBe(3);
  });

  it("does not count swipe rows for places no longer in the deck", () => {
    // A re-swiped verdict on a place that was removed from the deck must not
    // push the progress display past the deck size.
    const keys = buildSwipedKeys([{ card_id: "gen-removed", card_name: "Old Place" }]);
    const { unswiped, swipedCount } = partitionDeck(deck, keys);

    expect(unswiped).toHaveLength(3);
    expect(swipedCount).toBe(0);
  });
});
