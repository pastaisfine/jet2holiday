import { describe, it, expect } from "vitest";
import {
  buildSwipedKeys,
  addSwipedKey,
  removeSwipedKey,
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

describe("removeSwipedKey", () => {
  it("is the exact inverse of addSwipedKey", () => {
    const original = buildSwipedKeys([{ card_id: "gen-b", card_name: "Batu Caves" }]);
    const added = addSwipedKey(original, card("gen-a", "KLCC Park"));
    const removed = removeSwipedKey(added, card("gen-a", "KLCC Park"));

    expect(removed.ids.has("gen-a")).toBe(false);
    expect(removed.names.has("klcc park")).toBe(false);
    // The untouched card survives the round trip.
    expect(removed.ids.has("gen-b")).toBe(true);
    expect(removed.names.has("batu caves")).toBe(true);
  });

  it("returns the card to the deck after a regenerate changed its id", () => {
    // The name is the only thing that survives a regenerated deck, so undo has
    // to drop it or the card never comes back.
    const keys = buildSwipedKeys([{ card_id: "gen-old-uuid", card_name: "KLCC Park" }]);
    const regenerated = card("gen-new-uuid", "KLCC Park");
    expect(isCardSwiped(regenerated, keys)).toBe(true);

    const after = removeSwipedKey(keys, regenerated);
    expect(isCardSwiped(regenerated, after)).toBe(false);
  });

  it("undoes one of two same-named cards without disturbing the other", () => {
    // isCardSwiped merges same-named cards on the name fallback, but each keeps
    // its own id -- so undoing one must return exactly that one.
    const twinA = card("gen-a", "KLCC Park");
    const twinB = card("gen-b", "KLCC Park");
    const keys = buildSwipedKeys([
      { card_id: "gen-a", card_name: "KLCC Park" },
      { card_id: "gen-b", card_name: "KLCC Park" },
    ]);

    const after = removeSwipedKey(keys, twinA);

    expect(isCardSwiped(twinA, after)).toBe(false);
    expect(isCardSwiped(twinB, after)).toBe(true);
    expect(after.ids.has("gen-b")).toBe(true);
  });

  it("tolerates a missing card, a null key set and a nameless card", () => {
    const keys = buildSwipedKeys([{ card_id: "gen-a", card_name: "KLCC Park" }]);

    expect(removeSwipedKey(keys, null).ids.size).toBe(1);
    expect(removeSwipedKey(null, card("gen-a", "KLCC Park")).ids.size).toBe(0);
    expect(removeSwipedKey(keys, { id: "gen-a" }).ids.size).toBe(0);
  });

  it("ignores a blank name rather than deleting the empty key", () => {
    const keys = buildSwipedKeys([{ card_id: "gen-a", card_name: "KLCC Park" }]);
    const after = removeSwipedKey(keys, { id: "gen-a", name: "   " });

    expect(after.ids.size).toBe(0);
    expect(after.names.has("")).toBe(false);
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
