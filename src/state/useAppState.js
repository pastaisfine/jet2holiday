import { useState, useCallback, useMemo } from "react";
import { CARD_DATA } from "../data/cards";

const LS_KEY = "tripder-state-v1";

// Give each trip its own localStorage key.
const getTripStorageKey = (tripId) => `tripder-trip-${tripId}`;

const DEFAULT_STATE = {
  idx: 0,
  likes: 0,
  skips: 0,
  addedCards: [],
  // Which deck `addedCards` belongs to. Without it the local card list leaks
  // across trips: a member who opens another trip's link keeps the previous
  // trip's deck mixed into the new one.
  cardsDeckId: null,
  styleSeen: false,
  dest: "",
  startDate: null,
  endDate: null,
  leader: "alice",
  hotel: null,
  flight: null,
  carRental: null,
  styleName: "",
  preferenceProfiles: {},
  // Day currently open on the plan screen. The plan itself lives in Supabase
  // (trip_plans) so every member reads the same itinerary; only the UI cursor
  // is device-local.
  activeDayIndex: 0,
  pipelineCompleted: false,
  pipelineDest: "",
  pipelineThinFallback: false,
  // Why the deck fell back, when something is known. Paired with the flag
  // above because "we fell back" and "here is what went wrong" are different
  // claims, and only the second one needs the generator to have said so.
  pipelineFailureCode: null,
  tripId: null,
  // Whether this trip's leader has already been asked to invite their crew.
  // Device-local and namespaced per trip by the storage key above, so a new
  // trip asks again without any migration.
  invitePromptDismissed: false,
};

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const addedCards = (s.addedCards || []).map((card) =>
        card.img === "/images/hero-lisbon.jpg" || card.img === "/images/lisbon-rooftops.jpg"
          ? { ...card, img: "/images/alfama.jpg" }
          : card,
      );
      // `tasks` used to live here, seeded from a hardcoded Lisbon list, and
      // `s.tasks.length > 0 ? s.tasks : TASKS` meant deleting every task
      // resurrected the mock board on the next load. Tasks are now rows in
      // Supabase (see services/tasks.js); the stale key is dropped so it
      // cannot be picked up by a future reader who assumes it is live.
      delete s.tasks;
      // `tagged` held per-swipe reason chips that only ever existed in
      // localStorage. Reasons are gone from the product; the key is dropped so
      // the blob does not keep growing for the life of the install.
      delete s.tagged;
      return { ...DEFAULT_STATE, ...s, addedCards };
    }
  } catch {}
  return { ...DEFAULT_STATE };
}

// Streaming appends a card every few hundred ms, and each append called
// save(). Serialising the whole state to localStorage synchronously, twice per
// card, blocked the main thread mid-stream - so writes are coalesced onto a
// trailing timer and flushed eagerly when the page goes away.
const SAVE_DEBOUNCE_MS = 250;
let saveTimer = null;
let pendingSave = null;

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (!pendingSave) return;

  const state = pendingSave;
  pendingSave = null;

  try {
    const serialized = JSON.stringify(state);

    // Keep the active trip state for normal app loading.
    localStorage.setItem(LS_KEY, serialized);

    // Save a separate copy for this trip, if it has an ID.
    if (state.tripId) {
      localStorage.setItem(getTripStorageKey(state.tripId), serialized);
    }
  } catch {}
}

function save(state) {
  pendingSave = state;
  if (saveTimer) return;
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
}

export function useAppState() {
  const [state, setState] = useState(load);

  const update = useCallback((patch) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);
  const updateTrip = useCallback((tripId, patch) => {
  setState((prev) => {
    if (prev.tripId !== tripId) return prev;

    const changes =
      typeof patch === "function" ? patch(prev) : patch;

    const next = { ...prev, ...changes };
    save(next);
    return next;
    });
  }, []);

  const swipeCard = useCallback(
    (dir) => {
      setState((prev) => {
        const next = {
          ...prev,
          idx: prev.idx + 1,
          likes: prev.likes + (dir === "yes" ? 1 : 0),
          skips: prev.skips + (dir === "no" ? 1 : 0),
        };
        save(next);
        return next;
      });
    },
    [],
  );

  // Undoes a verdict, the exact counterpart of `swipeCard`. Counters are
  // clamped at zero because hydration rebuilds them from the database and a
  // localStorage value that predates this session can be behind it.
  const unswipeCard = useCallback(
    (dir) => {
      setState((prev) => {
        const next = {
          ...prev,
          idx: Math.max(0, prev.idx - 1),
          likes: dir === "yes" ? Math.max(0, prev.likes - 1) : prev.likes,
          skips: dir === "no" ? Math.max(0, prev.skips - 1) : prev.skips,
        };
        save(next);
        return next;
      });
    },
    [],
  );

  const setActiveDayIndex = useCallback((index) => {
    setState((prev) => {
      const next = { ...prev, activeDayIndex: Math.max(0, index) };
      save(next);
      return next;
    });
  }, []);

  const selectHotel = useCallback((id) => {
    setState((prev) => {
      const next = { ...prev, hotel: id };
      save(next);
      return next;
    });
  }, []);

  const selectFlight = useCallback((id) => {
    setState((prev) => {
      const next = { ...prev, flight: id };
      save(next);
      return next;
    });
  }, []);

  const selectCarRental = useCallback((id) => {
  setState((prev) => {
    const next = { ...prev, carRental: id };
    save(next);
    return next;
    });
  }, []);

  const setDest = useCallback((dest) => {
    setState((prev) => {
      const next = { ...prev, dest };
      save(next);
      return next;
    });
  }, []);

  const setDates = useCallback((startDate, endDate) => {
    setState((prev) => {
      const next = { ...prev, startDate, endDate };
      save(next);
      return next;
    });
  }, []);

  const setLeader = useCallback((leader) => {
    setState((prev) => {
      const next = { ...prev, leader };
      save(next);
      return next;
    });
  }, []);

  const markStyleSeen = useCallback((name) => {
    setState((prev) => {
      const next = { ...prev, styleSeen: true, styleName: name };
      save(next);
      return next;
    });
  }, []);

  const appendCard = useCallback((card) => {
    setState((prev) => {
      const next = { ...prev, addedCards: [...prev.addedCards, card] };
      save(next);
      return next;
    });
  }, []);

  const appendGeneratedCards = useCallback((cards) => {
    setState((prev) => {
      const existingIds = new Set(prev.addedCards.map((c) => c.id));
      const fresh = cards.filter((c) => !existingIds.has(c.id));
      if (fresh.length === 0) return prev;
      const next = { ...prev, addedCards: [...prev.addedCards, ...fresh] };
      save(next);
      return next;
    });
  }, []);

  const markPipelineCompleted = useCallback((dest) => {
    setState((prev) => {
      const next = { ...prev, pipelineCompleted: true, pipelineDest: dest };
      save(next);
      return next;
    });
  }, []);

  const resetTrip = useCallback(() => {
    setState(() => {
      // Tasks used to be carried across a reset while everything else was
      // cleared, which is how a new trip inherited the previous one's board.
      // They live in Supabase now, keyed by trip, so there is nothing to carry.
      const next = { ...DEFAULT_STATE };
      save(next);
      return next;
    });
  }, []);

  const startNewTrip = useCallback(() => {
  setState((prev) => {
    // Save the current trip before starting a new one.
    if (prev.tripId) {
      localStorage.setItem(
        getTripStorageKey(prev.tripId),
        JSON.stringify(prev)
      );
    }
    // Start a fresh trip without reusing the previous trip ID.
    const next = {
      ...DEFAULT_STATE,

      // Keep the user's saved preference profiles.
      preferenceProfiles: prev.preferenceProfiles,
    };

    // Save the new trip setup state to localStorage.
    save(next);
    return next;
  });
  }, []);

  const savePreferenceProfile = useCallback((profileId, preferences) => {
    setState((prev) => {
      const next = { ...prev, preferenceProfiles: { ...prev.preferenceProfiles, [profileId]: preferences } };
      save(next);
      return next;
    });
  }, []);

  const setTripId = useCallback((tripId) => {
    setState((prev) => {
      const next = { ...prev, tripId };
      save(next);
      return next;
    });
  }, []);

  const loadTrip = useCallback((trip) => {
    if (!trip) return;

    setState((prev) => {
    // Finish any pending save before switching trips.
    flushSave();

    // Already on this trip: keep the current state.
    if (prev.tripId === trip.id) {
      const next = {
        ...prev,
        dest: trip.destination || prev.dest,
        startDate: trip.start_date || prev.startDate,
        endDate: trip.end_date || prev.endDate,
      };

      save(next);
      return next;
    }

    // Preserve the current trip's local state.
    if (prev.tripId && prev.tripId !== trip.id) {
      localStorage.setItem(
        getTripStorageKey(prev.tripId),
        JSON.stringify(prev)
      );
    }

    // Restore the selected trip's previously saved state.
    let savedTrip = null;

    try {
      const raw = localStorage.getItem(
        getTripStorageKey(trip.id)
      );

      if (raw) {
        savedTrip = JSON.parse(raw);
      }
    } catch {}

    const next = {
      ...DEFAULT_STATE,
      ...(savedTrip || {}),
      preferenceProfiles: prev.preferenceProfiles,
      tripId: trip.id,
      dest: trip.destination || savedTrip?.dest || "",
      startDate: trip.start_date || savedTrip?.startDate || null,
      endDate: trip.end_date || savedTrip?.endDate || null,
    };

    save(next);
    return next;
    });
  }, []);

  const allCards = useMemo(() => [...CARD_DATA, ...state.addedCards], [state.addedCards]);

  const finished = state.idx >= allCards.length;

  return {
    ...state,
    allCards,
    finished,
    update,
    updateTrip,
    swipeCard,
    unswipeCard,
    selectHotel,
    selectFlight,
    selectCarRental,
    setDest,
    setDates,
    setLeader,
    setActiveDayIndex,
    markStyleSeen,
    appendCard,
    appendGeneratedCards,
    markPipelineCompleted,
    resetTrip,
    startNewTrip, 
    savePreferenceProfile,
    setTripId,
    loadTrip,
  };
}
