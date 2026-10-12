/**
 * Deck progress, derived from swipe rows rather than local position.
 *
 * Completion used to live only in localStorage (`idx`), so any reset path --
 * the invite link, a new device, cleared storage -- resurrected cards that were
 * already swiped. These helpers turn the durable swipe rows into the set of
 * cards a member has already judged, so the deck can show only what is left.
 *
 * Membership is matched by card id, falling back to a normalised place name:
 * a regenerated deck keeps a stable `gen-${place_id}` id for most places, but a
 * card without a place_id gets a fresh id on every generation, and a swipe on
 * "KLCC Park" must not be forgotten because its row id changed.
 */

export function normalizeDeckName(name) {
  return String(name || "").trim().toLowerCase();
}

/** The already-swiped identity of a deck, from `swipes` rows. */
export function buildSwipedKeys(rows = []) {
  const ids = new Set();
  const names = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    if (row.card_id != null) ids.add(String(row.card_id));
    if (row.card_name) names.add(normalizeDeckName(row.card_name));
  }

  return { ids, names };
}

export function isCardSwiped(card, keys) {
  if (!card || !keys) return false;
  if (keys.ids.has(String(card.id))) return true;
  return keys.names.has(normalizeDeckName(card.name));
}

/** Adds one card to a key set, used optimistically the moment a verdict lands. */
export function addSwipedKey(keys, card) {
  const ids = new Set(keys?.ids || []);
  const names = new Set(keys?.names || []);
  if (card) {
    if (card.id != null) ids.add(String(card.id));
    if (card.name) names.add(normalizeDeckName(card.name));
  }
  return { ids, names };
}

/**
 * Reverses `addSwipedKey` so an undone verdict puts the card back on the deck.
 *
 * Both the id and the name are dropped. The name is a fallback keyed for
 * regenerated decks -- a card whose id churns is only recognisable by its place
 * name (see `isCardSwiped`) -- so leaving it behind would keep the card out of
 * the deck and make undo silently do nothing.
 *
 * Two cards in one deck sharing a place name each keep their own id, so undoing
 * one returns exactly that one; only the shared name fallback is dropped.
 */
export function removeSwipedKey(keys, card) {
  const ids = new Set(keys?.ids || []);
  const names = new Set(keys?.names || []);
  if (!card) return { ids, names };

  if (card.id != null) ids.delete(String(card.id));

  const name = normalizeDeckName(card.name);
  if (name) names.delete(name);

  return { ids, names };
}

/**
 * Splits a deck into what is left to swipe and how many were already judged.
 * `swipedCount` counts cards in THIS deck, not swipe rows: rows for places no
 * longer in the deck must not inflate the progress display.
 */
export function partitionDeck(deck = [], keys) {
  const unswiped = [];
  let swipedCount = 0;

  for (const card of Array.isArray(deck) ? deck : []) {
    if (isCardSwiped(card, keys)) swipedCount += 1;
    else unswiped.push(card);
  }

  return { unswiped, swipedCount };
}
