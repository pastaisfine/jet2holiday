import { useState, useCallback, useMemo } from "react";
import { CARD_DATA } from "../data/cards";
import { TASKS } from "../data/tasks";

const LS_KEY = "tripder-state-v1";

const DEFAULT_STATE = {
  idx: 0,
  likes: 0,
  skips: 0,
  tagged: {},
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
  tasks: TASKS,
  // Day currently open on the plan screen. The plan itself lives in Supabase
  // (trip_plans) so every member reads the same itinerary; only the UI cursor
  // is device-local.
  activeDayIndex: 0,
  pipelineCompleted: false,
  pipelineDest: "",
  pipelineThinFallback: false,
  tripId: null,
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
      const tasks = s.tasks && s.tasks.length > 0 ? s.tasks : TASKS;
      return { ...DEFAULT_STATE, ...s, addedCards, tasks };
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
    localStorage.setItem(LS_KEY, JSON.stringify(state));
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

  const saveReason = useCallback((cardId, dir, reasons) => {
    setState((prev) => {
      const tagged = { ...prev.tagged };
      if (reasons.length) tagged[cardId] = { dir, reasons };
      const next = { ...prev, tagged };
      save(next);
      return next;
    });
  }, []);

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
    setState((prev) => {
      const next = {
        ...DEFAULT_STATE,
        tasks: prev.tasks,
      };
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
      const next = {
        ...prev,
        tripId: trip.id,
        dest: trip.destination || prev.dest,
        startDate: trip.start_date || prev.startDate,
        endDate: trip.end_date || prev.endDate,
      };
      save(next);
      return next;
    });
  }, []);

  const addTasks = useCallback((taskArray, createdBy) => {
    setState((prev) => {
      const newTasks = taskArray.map((t) => ({
        id: crypto.randomUUID(),
        title: String(t.title).trim(),
        description: t.description ? String(t.description).trim() : "",
        status: "open",
        assignedTo: null,
        createdBy: createdBy || "Someone",
        createdAt: new Date().toISOString(),
      }));
      const next = { ...prev, tasks: [...prev.tasks, ...newTasks] };
      save(next);
      return next;
    });
  }, []);

  const acceptTask = useCallback((taskId, userName) => {
    setState((prev) => {
      const next = {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId ? { ...t, status: "assigned", assignedTo: userName } : t
        ),
      };
      save(next);
      return next;
    });
  }, []);

  const completeTask = useCallback((taskId) => {
    setState((prev) => {
      const next = {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId ? { ...t, status: "done" } : t
        ),
      };
      save(next);
      return next;
    });
  }, []);

  const removeTask = useCallback((taskId) => {
    setState((prev) => {
      const next = { ...prev, tasks: prev.tasks.filter((t) => t.id !== taskId) };
      save(next);
      return next;
    });
  }, []);

  const allCards = useMemo(() => [...CARD_DATA, ...state.addedCards], [state.addedCards]);

  const reasonCount = useMemo(
    () => Object.values(state.tagged).reduce((sum, t) => sum + (t.reasons?.length || 0), 0),
    [state.tagged],
  );
  const finished = state.idx >= allCards.length;

  return {
    ...state,
    allCards,
    finished,
    reasonCount,
    update,
    swipeCard,
    saveReason,
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
    savePreferenceProfile,
    setTripId,
    loadTrip,
    addTasks,
    acceptTask,
    completeTask,
    removeTask,
  };
}
