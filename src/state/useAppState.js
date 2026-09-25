import { useState, useCallback, useMemo } from "react";
import { CARD_DATA } from "../data/cards";
import { PLAN } from "../data/plans";
import { TASKS } from "../data/tasks";

const LS_KEY = "tripder-state-v1";

const DEFAULT_STATE = {
  idx: 0,
  likes: 0,
  skips: 0,
  mode: "balanced",
  tagged: {},
  addedCards: [],
  styleSeen: false,
  planSeen: false,
  dest: "",
  startDate: null,
  endDate: null,
  leader: "alice",
  hotel: null,
  flight: null,
  carRental: null,
  styleName: "",
  activeItineraryId: "balanced",
  itineraryDrafts: {},
  userSuggestedItineraries: [],
  nextSuggestedNumber: 1,
  preferenceProfiles: {},
  tasks: TASKS,
  itineraryVotes: {},
  confirmedItineraryId: null,
  pipelineCompleted: false,
  pipelineDest: "",
  pipelineThinFallback: false,
};

function isDefaultItinerary(id) {
  return Boolean(PLAN[id]);
}

function getItinerary(state, id) {
  if (isDefaultItinerary(id)) {
    return { id, label: id, stops: PLAN[id].stops, kind: "default" };
  }
  return state.userSuggestedItineraries.find((itinerary) => itinerary.id === id) || null;
}

function getStops(state, id) {
  return state.itineraryDrafts[id]?.stops || getItinerary(state, id)?.stops || [];
}

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

function save(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {}
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

  const setMode = useCallback((mode) => {
    setState((prev) => {
      const next = { ...prev, mode, activeItineraryId: mode };
      save(next);
      return next;
    });
  }, []);

  const selectItinerary = useCallback((id) => {
    setState((prev) => {
      if (!getItinerary(prev, id)) return prev;
      const next = { ...prev, activeItineraryId: id, mode: isDefaultItinerary(id) ? id : prev.mode };
      save(next);
      return next;
    });
  }, []);

  const setItineraryStops = useCallback((id, stops) => {
    setState((prev) => {
      if (!getItinerary(prev, id)) return prev;
      const next = {
        ...prev,
        itineraryDrafts: { ...prev.itineraryDrafts, [id]: { stops } },
      };
      save(next);
      return next;
    });
  }, []);

  const discardItineraryDraft = useCallback((id) => {
    setState((prev) => {
      if (!prev.itineraryDrafts[id]) return prev;
      const { [id]: _, ...itineraryDrafts } = prev.itineraryDrafts;
      const next = { ...prev, itineraryDrafts };
      save(next);
      return next;
    });
  }, []);

  const saveItinerarySnapshot = useCallback((id) => {
    setState((prev) => {
      const source = getItinerary(prev, id);
      if (!source) return prev;
      const number = prev.nextSuggestedNumber;
      const itinerary = {
        id: `user-suggested-${number}`,
        label: `User-suggested ${number}`,
        kind: "suggested",
        sourceId: id,
        baseMode: isDefaultItinerary(id) ? id : source.baseMode || "balanced",
        stops: getStops(prev, id),
      };
      const { [id]: _, ...itineraryDrafts } = prev.itineraryDrafts;
      const next = {
        ...prev,
        activeItineraryId: itinerary.id,
        itineraryDrafts,
        userSuggestedItineraries: [...prev.userSuggestedItineraries, itinerary],
        nextSuggestedNumber: number + 1,
      };
      save(next);
      return next;
    });
  }, []);

  const deleteSuggestedItinerary = useCallback((id) => {
    setState((prev) => {
      const index = prev.userSuggestedItineraries.findIndex((itinerary) => itinerary.id === id);
      if (index < 0) return prev;
      const { [id]: _, ...itineraryDrafts } = prev.itineraryDrafts;
      const userSuggestedItineraries = prev.userSuggestedItineraries.filter((itinerary) => itinerary.id !== id);
      const previous = prev.userSuggestedItineraries[index - 1];
      const next = {
        ...prev,
        itineraryDrafts,
        userSuggestedItineraries,
        activeItineraryId: prev.activeItineraryId === id ? previous?.id || "balanced" : prev.activeItineraryId,
      };
      save(next);
      return next;
    });
  }, []);

  const restoreSuggestedItinerary = useCallback((itinerary, index) => {
    setState((prev) => {
      if (prev.userSuggestedItineraries.some((item) => item.id === itinerary.id)) return prev;
      const userSuggestedItineraries = [...prev.userSuggestedItineraries];
      userSuggestedItineraries.splice(index, 0, itinerary);
      const next = {
        ...prev,
        userSuggestedItineraries,
        activeItineraryId: itinerary.id,
      };
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

  const markPlanSeen = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, planSeen: true };
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

  const castVote = useCallback((itineraryId) => {
    setState((prev) => {
      const allIds = [
        "balanced",
        "foodfirst",
        "slower",
        ...prev.userSuggestedItineraries.map(i => i.id)
      ];
      const nextVotes = { ...prev.itineraryVotes };
      
      // The user casts 1 vote
      nextVotes[itineraryId] = (nextVotes[itineraryId] || 0) + 1;

      // Simulate 3 other members voting randomly, but slightly preferring the user's choice
      for (let i = 0; i < 3; i++) {
        const randomId = Math.random() > 0.4 ? itineraryId : allIds[Math.floor(Math.random() * allIds.length)];
        nextVotes[randomId] = (nextVotes[randomId] || 0) + 1;
      }

      const next = { ...prev, itineraryVotes: nextVotes };
      save(next);
      return next;
    });
  }, []);

  const confirmItinerary = useCallback((id) => {
    setState((prev) => {
      const next = { ...prev, confirmedItineraryId: id };
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
  const activeItinerary = useMemo(
    () => getItinerary(state, state.activeItineraryId) || getItinerary(state, "balanced"),
    [state],
  );
  const activeStops = useMemo(
    () => getStops(state, activeItinerary.id),
    [state, activeItinerary],
  );
  const isItineraryDirty = Boolean(state.itineraryDrafts[activeItinerary.id]);

  return {
    ...state,
    allCards,
    finished,
    reasonCount,
    activeItinerary,
    activeStops,
    isItineraryDirty,
    update,
    swipeCard,
    saveReason,
    setMode,
    selectItinerary,
    setItineraryStops,
    discardItineraryDraft,
    saveItinerarySnapshot,
    deleteSuggestedItinerary,
    restoreSuggestedItinerary,
    selectHotel,
    selectFlight,
    selectCarRental,
    setDest,
    setDates,
    setLeader,
    markStyleSeen,
    markPlanSeen,
    appendCard,
    appendGeneratedCards,
    markPipelineCompleted,
    resetTrip,
    savePreferenceProfile,
    addTasks,
    acceptTask,
    completeTask,
    removeTask,
    castVote,
    confirmItinerary,
  };
}
