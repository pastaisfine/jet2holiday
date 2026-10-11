import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { DragDropProvider, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable } from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import BottomSheet from "../components/BottomSheet";
import InfiniteSpiral from "../components/InfiniteSpiral";
import DayVoteBar from "../components/DayVoteBar";
import RebuildBanner from "../components/RebuildBanner";
import RevealCard from "../components/RevealCard";
import SuggestionsPanel from "../components/SuggestionsPanel";
import WhyThisPlan from "../components/WhyThisPlan";
import ReasonChips from "../components/ReasonChips";
import { searchPlaces } from "../services/placesAutocomplete";
import { getTripMembers } from "../services/tripService";
import { getPreferenceSummary } from "../services/preference";
import {
  callPlanAction,
  createSuggestion,
  dismissReveal,
  getPlanSuggestions,
  getTripDayVotes,
  isDayApproved,
  isDayRejected,
  isRevealDismissed,
  isSuggestionPassed,
  majorityNeeded,
  revealStats,
  saveDayVote,
  setSuggestionStatus,
  subscribePlanSuggestions,
  subscribeTripDayVotes,
  voteOnSuggestion,
  votesForDay,
} from "../services/planCollaboration";
import { useAuth } from "../context/useAuth";
import {
  useGroupPlan,
  loadGroupPlan,
  startGroupPlan,
  rerouteDay,
  saveValidatedPlan,
} from "../services/groupPlan";
import { formatLeg } from "../lib/scheduler";
import { buildItineraryPdf } from "../lib/pdf";
import { parseTripDate } from "../utils/date";
import Map, { Marker, Source, Layer } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { CalendarBlank, Plus, PencilSimple, Sparkle, WarningCircle } from "@phosphor-icons/react";

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CATEGORY_LABELS = {
  food: "Food",
  culture: "Attractions",
  nature: "Nature",
  shopping: "Shopping",
  nightlife: "Nightlife",
  wellness: "Wellness",
};

const DND_SENSORS = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Delay({ value: 300, tolerance: 8 })],
  }),
  KeyboardSensor,
];

/** Keep in sync with MAX_DAY_REBUILDS in supabase/functions/plan-actions. */
const MAX_DAY_REBUILDS = 3;

function dayLabel(day) {
  const date = parseTripDate(day.date);
  if (!date) return `Day ${day.day_index + 1}`;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${month}.${dayOfMonth} ${DAYS_SHORT[date.getDay()]}`;
}

function shortDate(value) {
  const date = parseTripDate(value);
  if (!date) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function shortDestination(dest) {
  return (dest || "Your trip").split(",")[0].trim();
}

function categoryLabel(category) {
  return CATEGORY_LABELS[category] || "Attractions";
}

function balanceWidth(level) {
  if (level === "high") return "100%";
  if (level === "low") return "28%";
  return "60%";
}

function dayBounds(day) {
  const coords = (day?.stops || [])
    .filter((s) => typeof s.lng === "number" && typeof s.lat === "number")
    .map((s) => [s.lng, s.lat]);

  if (coords.length === 0) return null;

  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

const WalkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="13" cy="4" r="2" />
    <path d="m10 22 2-6-2-3 2-4 3 2 3 1M12 9l-3 2-2 4M14 16l4 6" />
  </svg>
);

const DriveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 17h14M6 17v2M18 17v2M4 13l1.5-5A2 2 0 0 1 7.4 6.5h9.2a2 2 0 0 1 1.9 1.5L20 13v4H4v-4Z" />
    <circle cx="7.5" cy="14.5" r="1" />
    <circle cx="16.5" cy="14.5" r="1" />
  </svg>
);

function DragPreview({ stop }) {
  return (
    <div className="stop-drag-preview" aria-hidden="true">
      <div className="stop card open">
        <div className="stop-top">
          <div className="th"><img src={stop.img} alt="" /></div>
          <div><div className="nm">{stop.name}</div><div className="ar">{stop.area}</div></div>
        </div>
      </div>
    </div>
  );
}

function ScheduledStop({ stop, index, total, open, menuId, setOpen, setMenuId, onEdit, editable = false }) {
  const { ref: draggableRef, handleRef, isDragSource } = useDraggable({ id: stop.id, type: "itinerary-stop", disabled: !editable });
  const { ref: droppableRef, isDropTarget } = useDroppable({ id: `drop:${stop.id}`, accept: "itinerary-stop" });
  const legText = formatLeg(stop.leg);
  const expanded = Boolean(open[stop.id]);

  return (
    <div className="timeline-item">
      <div
        ref={(element) => { draggableRef(element); droppableRef(element); }}
        className={`stoprow ${isDragSource ? "dragging" : ""} ${isDropTarget ? "drag-over" : ""}`}
        data-stop-id={stop.id}
      >
        <div className={`stopsheet ${expanded ? "open" : ""}`}>
          <button className="stopsheet-media" onClick={() => setOpen((prev) => ({ ...prev, [stop.id]: !prev[stop.id] }))}>
            <img src={stop.img} alt={stop.area ? `${stop.name}, ${stop.area}` : stop.name} referrerPolicy="no-referrer" />
          </button>
          <div className="stopsheet-body">
            <div className="stopsheet-cat">{categoryLabel(stop.category)}</div>
            <div className="stopsheet-title">
              {editable && (
                <button ref={handleRef} className="drag-handle" aria-label={`Long press to drag ${stop.name}`} onClick={(event) => event.stopPropagation()}>⠿</button>
              )}
              {index + 1}. {stop.name}
            </div>
            <div className="stopsheet-time-row">
              <span className={`stopsheet-time ${stop.late ? "late" : ""}`}>
                {stop.t} - {stop.end}
              </span>
              {stop.late && <span className="stopsheet-late"><WarningCircle size={13} /> Tight day</span>}
              {editable && (
                <button className="stopsheet-edit" aria-label={`Edit ${stop.name}`} onClick={() => setMenuId(menuId === stop.id ? null : stop.id)}>
                  <PencilSimple size={15} />
                </button>
              )}
            </div>
            {editable && menuId === stop.id && (
              <div className="stop-menu" onClick={(event) => event.stopPropagation()}>
                <button onClick={() => { onEdit("replace", stop); setMenuId(null); }}>Replace</button>
                <button disabled={index === 0} onClick={() => { onEdit("earlier", stop); setMenuId(null); }}>Move earlier</button>
                <button disabled={index === total - 1} onClick={() => { onEdit("later", stop); setMenuId(null); }}>Move later</button>
                <button className="danger" onClick={() => { onEdit("remove", stop); setMenuId(null); }}>Remove</button>
              </div>
            )}
            <div className="stopsheet-desc">{stop.description || "No description recorded for this place."}</div>
            {expanded && stop.why && (
              <div className="stopsheet-why"><Sparkle size={13} weight="fill" /> {stop.why}</div>
            )}
          </div>
        </div>
        {index < total - 1 && (
          <div className={`route-leg ${legText ? "" : "unavailable"}`}>
            {stop.transportMode === "driving" ? <DriveIcon /> : <WalkIcon />}
            {legText ? <span>{legText}</span> : <span>Route details unavailable</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlanScreen({ useAppState }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const {
    dest,
    tripId,
    startDate,
    endDate,
    activeDayIndex,
    setActiveDayIndex,
  } = useAppState;
  const { plan, phase, error } = useGroupPlan();

  const [tab, setTab] = useState("day");
  const [open, setOpen] = useState({});
  const [menuId, setMenuId] = useState(null);
  const [sheetAction, setSheetAction] = useState(null);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState([]);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(null);
  const [members, setMembers] = useState([]);
  const [dayVotes, setDayVotes] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [revealDismissed, setRevealDismissed] = useState(true);
  const [voteSheet, setVoteSheet] = useState(null);
  const [voteReasons, setVoteReasons] = useState([]);
  const [voteFree, setVoteFree] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [suggestStep, setSuggestStep] = useState(null);
  const [suggestOld, setSuggestOld] = useState(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState("");
  const [pdfError, setPdfError] = useState("");
  const debounceRef = useRef(null);
  const mapRef = useRef(null);
  
const [myLocation, setMyLocation] = useState(null);
const [locationError, setLocationError] = useState("");
const [isTracking, setIsTracking] = useState(false);
const locationWatchRef = useRef(null);


/**
 * 停止定位跟踪功能
 * 该函数用于清除当前的地理位置监听，并更新跟踪状态
 */
  // 检查是否存在有效的地理位置监听ID
const stopMyLocation = () => {
  if (locationWatchRef.current !== null) {
    navigator.geolocation.clearWatch(locationWatchRef.current);
    locationWatchRef.current = null;
  }

  setIsTracking(false);
};

const startMyLocation = () => {
  if (!navigator.geolocation) {
    setLocationError("Geolocation is not supported by this browser.");
    return;
  }

  // Avoid creating multiple location watchers.
  if (locationWatchRef.current !== null) return;

  setLocationError("");

  locationWatchRef.current = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;

      // Keep the location in this user's browser state only.
      setMyLocation({ latitude, longitude, accuracy });
      setLocationError("");
      setIsTracking(true);

      // Center the map on the user's current position.
      mapRef.current?.flyTo({
        center: [longitude, latitude],
        zoom: 16,
        duration: 800,
      });
    },
    (error) => {
      setLocationError(
        error.code === 1
          ? "Location permission denied. Allow location access in your browser."
          : error.code === 2
            ? "Your location is unavailable. Check your device's location settings."
            : "Location request timed out. Please try again."
      );

      stopMyLocation();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 15000,
    }
  );
};

useEffect(() => {
  return () => {
    if (locationWatchRef.current !== null) {
      navigator.geolocation.clearWatch(locationWatchRef.current);
      locationWatchRef.current = null;
    }
  };
}, []);



  const rebuildingRef = useRef(new Set());
  const applyingRef = useRef(new Set());

  const validated = plan?.validated_plan || null;
  const days = useMemo(() => validated?.days || [], [validated]);
  const groupProfile = plan?.group_profile || null;
  const planStatus = plan?.status || null;
  const stats = useMemo(() => revealStats(plan), [plan]);
  const isLeader = useMemo(
    () => members.some((m) => m.userId === profile?.id && m.role === "leader"),
    [members, profile?.id],
  );
  const memberCount = members.length || 1;
  // Voting opens the moment a validated plan exists, and stays open until the
  // leader confirms. Editing is locked while votes are being cast so the thing
  // being voted on cannot move.
  const votingOpen = planStatus === "ready" && Boolean(validated);
  const confirmed = planStatus === "confirmed";
  const approvedCount = days.filter((d) => isDayApproved(dayVotes, d.day_index, memberCount)).length;
  const allDaysApproved = days.length > 0 && approvedCount === days.length;
  const rebuildInfo = useCallback(
    (dayIndex) => plan?.rebuilds?.[String(dayIndex)] || null,
    [plan?.rebuilds],
  );
  const rebuildCount = useCallback(
    (dayIndex) => rebuildInfo(dayIndex)?.count || 0,
    [rebuildInfo],
  );
  // After the rebuild cap the agents stop guessing; the leader edits that day
  // by hand with the existing drag/re-route tools.
  const canEditDay = (dayIndex) => !confirmed && Boolean(isLeader) && rebuildCount(dayIndex) >= MAX_DAY_REBUILDS;

  const reasonChips = useMemo(() => {
    const balance = groupProfile?.recommended_balance || {};
    const chips = ["Too packed", "Too much downtime"];
    if (balance.food && balance.food !== "low") chips.push("Want more food stops");
    if (balance.culture && balance.culture !== "low") chips.push("Want more landmarks");
    if (balance.nature && balance.nature !== "low") chips.push("More nature please");
    if (balance.nightlife && balance.nightlife !== "low") chips.push("More nightlife");
    chips.push("Too much walking");
    const conflict = groupProfile?.group_conflicts?.[0];
    if (conflict?.topic) chips.push(`Sort out: ${conflict.topic}`);
    return [...new Set(chips)].slice(0, 8);
  }, [groupProfile]);
  const safeDayIndex = Math.min(activeDayIndex, Math.max(0, days.length - 1));
  const day = days[safeDayIndex] || null;
  const currentDayEditable = day ? canEditDay(day.day_index) : false;
  const unassigned = useMemo(() => validated?.unassigned || [], [validated]);
  // Until the user picks a tab, the plan opens on the day they last viewed.
  const activeTab = tab === "day" ? `day-${safeDayIndex}` : tab;

  useEffect(() => {
    if (tripId) loadGroupPlan(tripId);
  }, [tripId]);

  useEffect(() => {
    if (!tripId) return;
    let active = true;
    getTripMembers(tripId).then((list) => { if (active) setMembers(list); });
    return () => { active = false; };
  }, [tripId]);

  // Whether the traveller reading this plan has a preference summary to
  // review. Read-only existence check, never an agent run -- a member whose
  // summary is missing (mid-swipe when the build started) gets no link, and an
  // excluded member still gets theirs.
  const [ownSummaryExists, setOwnSummaryExists] = useState(false);
  useEffect(() => {
    if (!tripId && !dest) return undefined;
    let active = true;
    getPreferenceSummary({ tripId, destination: dest })
      .then((row) => { if (active) setOwnSummaryExists(Boolean(row)); })
      .catch(() => { if (active) setOwnSummaryExists(false); });
    return () => { active = false; };
  }, [tripId, dest]);

  useEffect(() => {
    setRevealDismissed(isRevealDismissed(tripId));
  }, [tripId]);

  // Votes and suggestions are the collaborative layer; both are refetched
  // wholesale on any Realtime change. At group sizes this is the simplest
  // correct thing, and the payloads are tiny.
  useEffect(() => {
    if (!tripId) return undefined;
    let active = true;
    const load = async () => {
      const [votes, nextSuggestions] = await Promise.all([
        getTripDayVotes(tripId),
        getPlanSuggestions(tripId),
      ]);
      if (!active) return;
      setDayVotes(votes);
      setSuggestions(nextSuggestions);
    };
    load();
    const unsubVotes = subscribeTripDayVotes(tripId, load);
    const unsubSuggestions = subscribePlanSuggestions(tripId, load);
    return () => {
      active = false;
      unsubVotes();
      unsubSuggestions();
    };
  }, [tripId]);

  // Majority thumbs-down on a day hands it back to the Itinerary Agent, taking
  // the voters' reasons with it. The expected rebuild count dedupes the call
  // across every member's client: the first one wins, the rest are told the
  // plan has already moved on.
  useEffect(() => {
    if (!votingOpen || !tripId || days.length === 0) return;
    for (const planDay of days) {
      const index = planDay.day_index;
      const count = rebuildCount(index);
      if (count >= MAX_DAY_REBUILDS) continue;
      if (!isDayRejected(dayVotes, index, memberCount)) continue;
      const key = `${index}:${count}`;
      if (rebuildingRef.current.has(key)) continue;
      rebuildingRef.current.add(key);
      const reasons = [...new Set(
        votesForDay(dayVotes, index)
          .filter((v) => v.vote === "down")
          .flatMap((v) => v.reasons || []),
      )];
      callPlanAction({
        tripId,
        action: "rebuild-day",
        dayIndex: index,
        reasons,
        expectedRebuildCount: count,
      })
        .catch((err) => console.warn("Day rebuild skipped:", err?.message || err))
        .finally(() => rebuildingRef.current.delete(key));
    }
  }, [votingOpen, tripId, days, dayVotes, memberCount, rebuildCount]);

  useEffect(() => {
    if (!undo) return undefined;
    const timeout = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [undo]);

  // Fit the map to whichever day is on screen.
  useEffect(() => {
    if (!mapRef.current || !day) return;
    const bounds = dayBounds(day);
    if (!bounds) return;
    const [sw, ne] = bounds;
    if (sw[0] === ne[0] && sw[1] === ne[1]) {
      mapRef.current.flyTo({ center: sw, zoom: 14, duration: 800 });
      return;
    }
    mapRef.current.fitBounds([sw, ne], { padding: 56, duration: 800, maxZoom: 15 });
  }, [day]);

  const spiralItems = useMemo(
    () => days.flatMap((d) => d.stops.map((stop) => ({ id: `${d.day_index}-${stop.id}`, src: stop.img, alt: stop.name }))),
    [days],
  );

  /**
   * Every edit goes through the same routing + scheduling path as generation,
   * so times and travel legs always reflect the map, never the previous plan.
   */
  const applyStops = useCallback(async (dayIndex, stops, { keepOrder = true, nextUnassigned, dayOverride } = {}) => {
    const targetDay = dayOverride || day;
    if (!targetDay || !validated) return;
    setBusy(true);
    try {
      const rebuilt = await rerouteDay({ day: targetDay, stops, keepOrder });
      const nextDays = validated.days.map((d) => (d.day_index === dayIndex ? rebuilt : d));
      await saveValidatedPlan(tripId, {
        ...validated,
        days: nextDays,
        unassigned: nextUnassigned ?? validated.unassigned,
      });
    } finally {
      setBusy(false);
    }
  }, [day, validated, tripId]);

  /* ---- Group voting --------------------------------------------------- */

  const myUserId = profile?.id;
  const castVote = useCallback(async (dayIndex, vote, reasons = []) => {
    if (!tripId || !myUserId || confirmed) return;
    try {
      await saveDayVote({ tripId, userId: myUserId, dayIndex, vote, reasons });
    } catch (err) {
      console.warn("Could not save vote:", err?.message || err);
    }
  }, [tripId, myUserId, confirmed]);

  const openDownVote = (dayIndex) => {
    setVoteSheet({ dayIndex });
    setVoteReasons([]);
    setVoteFree("");
  };

  const submitDownVote = async () => {
    if (!voteSheet) return;
    const reasons = [...voteReasons];
    if (voteFree.trim()) reasons.push(voteFree.trim());
    await castVote(voteSheet.dayIndex, "down", reasons);
    setVoteSheet(null);
  };

  const confirmPlan = async () => {
    if (!tripId || !validated) return;
    setConfirmBusy(true);
    setConfirmError("");
    try {
      await callPlanAction({ tripId, action: "confirm" });
    } catch (err) {
      setConfirmError(err?.message || "Could not confirm the plan.");
    } finally {
      setConfirmBusy(false);
    }
  };

  /* ---- Post-confirm suggestions --------------------------------------- */

  const applySuggestion = useCallback(async (suggestion) => {
    const targetDay = days.find((d) => d.day_index === suggestion.day_index);
    if (!targetDay || !validated) return;
    const payload = suggestion.payload || {};

    if (suggestion.type === "add") {
      const stop = payload.stop;
      if (!stop || !stop.card_id) return;
      if (targetDay.stops.some((s) => s.card_id === stop.card_id)) return;
      const placed = { ...stop, id: stop.card_id, t: null, end: null, leg: null, late: false, lunch: false };
      await applyStops(suggestion.day_index, [...targetDay.stops, placed], {
        keepOrder: true,
        dayOverride: targetDay,
        nextUnassigned: (validated.unassigned || []).filter((s) => s.card_id !== stop.card_id),
      });
    } else if (suggestion.type === "remove") {
      const id = payload.stop_id;
      await applyStops(
        suggestion.day_index,
        targetDay.stops.filter((s) => s.id !== id && s.card_id !== id),
        { keepOrder: true, dayOverride: targetDay },
      );
    } else if (suggestion.type === "replace") {
      const place = payload.place;
      if (!place) return;
      const oldId = payload.old_id;
      const placed = { ...place, id: place.id || `user-${crypto.randomUUID().slice(0, 8)}`, t: null, end: null, leg: null, late: false, lunch: false };
      await applyStops(
        suggestion.day_index,
        targetDay.stops.map((s) => (s.id === oldId || s.card_id === oldId ? placed : s)),
        { keepOrder: true, dayOverride: targetDay },
      );
    }

    await setSuggestionStatus(suggestion.id, "applied");
  }, [days, validated, applyStops]);

  // Whichever member's client first sees a suggestion pass applies it through
  // the same routing path as a manual edit, then marks it applied for everyone.
  useEffect(() => {
    if (!confirmed || !validated || suggestions.length === 0) return;
    const passed = suggestions.find((s) => s.status === "open" && isSuggestionPassed(s, memberCount));
    if (!passed || applyingRef.current.has(passed.id)) return;
    applyingRef.current.add(passed.id);
    setBusy(true);
    applySuggestion(passed)
      .catch((err) => console.warn("Could not apply suggestion:", err?.message || err))
      .finally(() => {
        applyingRef.current.delete(passed.id);
        setBusy(false);
      });
  }, [confirmed, validated, suggestions, memberCount, applySuggestion]);

  const submitSuggestionVote = async (suggestion, vote) => {
    if (!profile?.id) return;
    try {
      await voteOnSuggestion({ suggestionId: suggestion.id, userId: profile.id, vote });
    } catch (err) {
      console.warn("Could not save suggestion vote:", err?.message || err);
    }
  };

  const submitSuggestion = async (type, payload) => {
    if (!tripId || !profile?.id || !day) return;
    setSuggestBusy(true);
    try {
      await createSuggestion({ tripId, userId: profile.id, dayIndex: day.day_index, type, payload });
      setSuggestStep(null);
      setSuggestOld(null);
    } catch (err) {
      console.warn("Could not create suggestion:", err?.message || err);
    } finally {
      setSuggestBusy(false);
    }
  };

  const handleEdit = (action, stop) => {
    if (!currentDayEditable) return;
    if (!day) return;
    const index = day.stops.findIndex((s) => s.id === stop.id);
    if (index < 0) return;

    if (action === "remove") {
      const removed = day.stops[index];
      const nextStops = day.stops.filter((s) => s.id !== stop.id);
      setUndo({ kind: "remove", dayIndex: day.day_index, stop: removed, previousStops: day.stops });
      applyStops(day.day_index, nextStops, {
        keepOrder: true,
        nextUnassigned: [...unassigned, { ...removed, leg: null, t: null, end: null }],
      });
      return;
    }

    if (action === "earlier" || action === "later") {
      const target = index + (action === "earlier" ? -1 : 1);
      if (target < 0 || target >= day.stops.length) return;
      const nextStops = [...day.stops];
      const [moved] = nextStops.splice(index, 1);
      nextStops.splice(target, 0, moved);
      applyStops(day.day_index, nextStops, { keepOrder: true });
      return;
    }

    if (action === "replace") {
      setSheetAction({ type: "replace", stop });
    }
  };

  const finishDrag = (sourceId, targetId) => {
    if (!currentDayEditable) return;
    if (!day || !sourceId || !targetId || sourceId === targetId) return;
    const from = day.stops.findIndex((s) => s.id === sourceId);
    const to = day.stops.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0) return;
    const nextStops = [...day.stops];
    const [moved] = nextStops.splice(from, 1);
    nextStops.splice(to, 0, moved);
    applyStops(day.day_index, nextStops, { keepOrder: true });
  };

  const addIdeaToDay = (stop) => {
    if (!day || !validated || !currentDayEditable) return;
    // Ideas carry a card_id but no UI id (ids are assigned when a stop is
    // scheduled); without one the drag handle and React key both break.
    const placed = { ...stop, id: stop.card_id || stop.id, t: null, end: null, leg: null, late: false, lunch: false };
    applyStops(day.day_index, [...day.stops, placed], {
      keepOrder: true,
      nextUnassigned: unassigned.filter((s) => s.card_id !== stop.card_id),
    });
  };

  const handlePlaceSearch = (value) => {
    setPlaceQuery(value);
    setPlaceError("");
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setPlaceResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setPlaceLoading(true);
      try {
        setPlaceResults(await searchPlaces(value));
      } catch (err) {
        setPlaceError(err.message || "Search failed");
        setPlaceResults([]);
      } finally {
        setPlaceLoading(false);
      }
    }, 350);
  };

  const applyPlace = async (place) => {
    if (!day) return;

    const buildStop = () => ({
      id: `user-${place.placeId}-${crypto.randomUUID().slice(0, 8)}`,
      card_id: `user-${place.placeId}`,
      name: place.mainText,
      area: place.secondaryText || "Custom location",
      category: "culture",
      description: place.description || "Added by you.",
      img: place.mapImageUrl || "",
      lat: place.lat ?? null,
      lng: place.lng ?? null,
      estimatedDuration: null,
      rating: null,
      why: "Added by the group.",
    });

    // A confirmed plan is never edited directly: the pick becomes a suggestion
    // the rest of the group votes on.
    if (suggestStep === "replace-search" && suggestOld) {
      const stop = buildStop();
      setPlaceQuery("");
      setPlaceResults([]);
      await submitSuggestion("replace", {
        old_id: suggestOld.id || suggestOld.card_id,
        old_name: suggestOld.name,
        place: stop,
      });
      setSuggestOld(null);
      return;
    }

    if (!currentDayEditable) return;

    const replacing = sheetAction?.type === "replace";
    const oldStop = sheetAction?.stop;
    const stop = buildStop();

    setSheetAction(null);
    setPlaceQuery("");
    setPlaceResults([]);

    const nextStops = replacing
      ? day.stops.map((s) => (s.id === oldStop.id ? stop : s))
      : [...day.stops, stop];

    await applyStops(day.day_index, nextStops, { keepOrder: true });
  };

  const setTransportMode = (mode) => {
    if (!day || !validated || day.transport_mode === mode || !currentDayEditable) return;
    applyStops(day.day_index, day.stops, { keepOrder: true, dayOverride: { ...day, transport_mode: mode } });
  };

  /**
   * Builds and saves the itinerary PDF.
   *
   * The document is assembled in the browser from the plan as it stands right
   * now, so what lands on disk always matches what this person can see -- which
   * matters because a confirmed plan is not frozen: members keep voting
   * suggestions through and a day's stops can still change after confirmation.
   *
   * Fetching every photo and map is most of the wall clock, so the button
   * reports it rather than looking hung. A failure inside the builder is
   * reported too, because "nothing happened" is the worst possible outcome for
   * a download button.
   */
  const downloadItineraryPDF = async () => {
    if (!validated || pdfBusy) return;
    setPdfBusy(true);
    setPdfError("");
    setPdfProgress("");
    try {
      const { doc, filename, skipped } = await buildItineraryPdf({
        trip: { destination: dest, start_date: startDate, end_date: endDate },
        plan,
        members,
        destination: dest,
        onProgress: (done, total) => {
          setPdfProgress(done < total ? `Building your PDF… ${done} of ${total}` : "Almost there…");
        },
      });
      doc.save(filename);
      setPdfProgress(
        skipped > 0
          ? `Saved ${filename}. ${skipped} image${skipped === 1 ? "" : "s"} could not be loaded.`
          : "",
      );
    } catch (err) {
      console.error("Could not build the itinerary PDF:", err);
      setPdfError("Could not build the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  const tabs = days.map((d, index) => ({ id: `day-${index}`, label: dayLabel(d), index }));

  const renderGroupPlanState = () => {
    if (phase === "planning" || phase === "loading") {
      return (
        <div className="plan-state">
          <div className="plan-state-spinner" aria-hidden="true" />
          <h3>Reading the group's swipes…</h3>
          <p>The Group Planner is comparing summaries and finding the compromises.</p>
        </div>
      );
    }

    if (phase === "scheduling") {
      return (
        <div className="plan-state">
          <div className="plan-state-spinner" aria-hidden="true" />
          <h3>Plotting the route…</h3>
          <p>Mapbox is ordering each day and the scheduler is setting the times.</p>
        </div>
      );
    }

    if (phase === "error") {
      return (
        <div className="plan-state">
          <h3>We couldn't finish the plan</h3>
          <p>{error}</p>
          {isLeader ? (
            <button className="btn btn-primary" onClick={() => startGroupPlan({ tripId, force: true })}>Try again</button>
          ) : (
            <p className="plan-empty-note">The trip creator can retry the build.</p>
          )}
        </div>
      );
    }

    return (
      <div className="plan-state">
        <h3>The plan isn't built yet</h3>
        <p>
          {isLeader
            ? "When enough of the group has finished swiping, build one shared itinerary from their summaries. You can build with whoever is ready."
            : "The trip creator builds the shared itinerary once the group has finished swiping. You'll see it here the moment it's ready."}
        </p>
        {isLeader ? (
          <button className="btn btn-primary" onClick={() => startGroupPlan({ tripId })}>Build the group plan</button>
        ) : (
          <p className="plan-empty-note">Only the trip creator can start the build.</p>
        )}
      </div>
    );
  };

  return (
    <section className="screen active spiral-screen spiral-screen--plan">
      <div className="spiral-backdrop" aria-hidden="true">
        <InfiniteSpiral
          items={spiralItems}
          speed={0.16}
          radius={235}
          cardWidth={168}
          cardHeight={116}
          verticalSpacing={92}
          cardsPerTurn={6}
          rotation={18}
          cardTilt={-4}
          cardRadius={18}
          centerScale={1.05}
          edgeFade={0.18}
          edgeBlur={8}
          grayscale={0.32}
          pauseOnHover={false}
        />
      </div>

      <div className="plan-head">
        <div className="eyebrow">{days.length ? `${days.length} day${days.length === 1 ? "" : "s"} · shared plan` : "shared plan"}</div>
        <div className="day">{shortDestination(dest)}</div>
        {/* A control that only exists below the fold reads as absent: this is
            the one the person who asked for a PDF will actually see. */}
        {confirmed && (
          <button
            className="btn btn-secondary btn-xs plan-head-pdf"
            disabled={pdfBusy}
            onClick={downloadItineraryPDF}
          >
            {pdfBusy ? "Building…" : "Save as PDF"}
          </button>
        )}
      </div>

      {!validated ? (
        renderGroupPlanState()
      ) : (
        <>
          {stats && !revealDismissed && (
            <RevealCard
              stats={stats}
              onDismiss={() => { dismissReveal(tripId); setRevealDismissed(true); }}
              onView={() => { dismissReveal(tripId); setRevealDismissed(true); }}
            />
          )}


          <div className="my-location-controls">
           {!isTracking ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={startMyLocation}
            >
            📍 Show my location
            </button>
             ) : (
            <button
             type="button"
             className="btn btn-secondary"
             onClick={stopMyLocation}
            >
            Stop location
            </button>
            )}

            {isTracking && (
             <span className="my-location-status">
               Live location enabled
             </span>
             )}

            {locationError && (
             <p className="my-location-error" role="alert">
               {locationError}
             </p>
            )}
</div>


          <div className="plan-map-card">
            <Map
              ref={mapRef}
              initialViewState={{ longitude: day?.stops?.[0]?.lng || 101.7116, latitude: day?.stops?.[0]?.lat || 3.1578, zoom: 13 }}
              mapStyle="mapbox://styles/mapbox/streets-v12"
              mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
              attributionControl={false}
            >
              {day?.geometry && (
                <Source id="plan-route" type="geojson" data={day.geometry}>
                  <Layer
                    id="plan-route-line"
                    type="line"
                    layout={{ "line-join": "round", "line-cap": "round" }}
                    paint={{ "line-color": "#4A90D9", "line-width": 4, "line-opacity": 0.9 }}
                  />
                </Source>
              )}
              {day?.stops?.map((stop, index) =>
                typeof stop.lng === "number" && typeof stop.lat === "number" ? (
                  <Marker key={stop.id} longitude={stop.lng} latitude={stop.lat} anchor="center">
                    <div className="plan-pin">{index + 1}</div>
                  </Marker>
                ) : null,
              )}


             {/* Private marker: visible only in this user's browser */}
              {myLocation && (
               <Marker
                longitude={myLocation.longitude}
                latitude={myLocation.latitude}
                 anchor="center"
               >
               <div className="my-location-marker" title="Your current location">
               <span className="my-location-pulse" />
               <span className="my-location-dot" />
               </div>
               </Marker>
              )}
             </Map>
          </div>

          <div className="plan-sheet">
            <div className="plan-sheet-head">
              <h2 className="plan-title">
                {shortDestination(dest)} {days.length}-Day City Highlights
              </h2>
              <div className="plan-meta">
                <span className="plan-meta-left">
                  <CalendarBlank size={16} weight="bold" />
                  {shortDate(days[0]?.date)}-{shortDate(days[days.length - 1]?.date)} · {days.length} Day{days.length === 1 ? "" : "s"}
                </span>
                <span className="plan-meta-right">
                  {ownSummaryExists && (
                    <button
                      className="plan-own-summary"
                      onClick={() => navigate("/style", { state: { from: "plan" } })}
                    >
                      See my summary
                    </button>
                  )}
                  <span className="plan-avatars">
                    {members.slice(0, 3).map((member) => (
                      <span key={member.userId} className="plan-avatar" style={{ background: member.avatarColor }}>
                        {(member.username || "?").slice(0, 1).toUpperCase()}
                      </span>
                    ))}
                    <button className="plan-avatar plan-avatar-add" aria-label="Invite members" onClick={() => navigate("/group")}>
                      <Plus size={13} weight="bold" />
                    </button>
                  </span>
                </span>
              </div>
            </div>

            <div className="plan-tabs" role="tablist" aria-label="Plan views">
              <button
                role="tab"
                aria-selected={activeTab === "summary"}
                className={`plan-tab ${activeTab === "summary" ? "sel" : ""}`}
                onClick={() => setTab("summary")}
              >
                Summary
              </button>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={activeTab === t.id}
                  className={`plan-tab ${activeTab === t.id ? "sel" : ""}`}
                  onClick={() => { setTab(t.id); setActiveDayIndex(t.index); }}
                >
                  {t.label}
                </button>
              ))}
              <button
                role="tab"
                aria-selected={activeTab === "ideas"}
                className={`plan-tab ${activeTab === "ideas" ? "sel" : ""}`}
                onClick={() => setTab("ideas")}
              >
                Ideas
              </button>
            </div>

            {activeTab === "summary" && (
              <div className="plan-summary">
                <WhyThisPlan rationale={plan?.rationale} />

                {groupProfile?.group_priorities?.length > 0 && (
                  <div className="plan-block">
                    <div className="plan-block-title">What the group agrees on</div>
                    <div className="plan-chips">
                      {groupProfile.group_priorities.map((item) => (
                        <span key={item} className="chip sel">{item}</span>
                      ))}
                    </div>
                  </div>
                )}

                {groupProfile?.recommended_balance && (
                  <div className="plan-block">
                    <div className="plan-block-title">Balance</div>
                    <div className="plan-balance">
                      {Object.entries(groupProfile.recommended_balance).map(([category, level]) => (
                        <div className="plan-balance-row" key={category}>
                          <span className="plan-balance-label">{categoryLabel(category)}</span>
                          <span className="plan-balance-track">
                            <i style={{ width: balanceWidth(level) }} />
                          </span>
                          <span className="plan-balance-level">{level}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="plan-block">
                  <div className="plan-block-title">Where the group split</div>
                  {groupProfile?.group_conflicts?.length > 0 ? (
                    <div className="plan-conflicts">
                      {groupProfile.group_conflicts.map((conflict, index) => (
                        <div className="plan-conflict" key={index}>
                          <div className="plan-conflict-topic">{conflict.topic}</div>
                          <div className="plan-conflict-sides">
                            <span>{conflict.members_a.join(", ")}</span>
                            <span className="plan-conflict-vs">vs</span>
                            <span>{conflict.members_b.join(", ")}</span>
                          </div>
                          <div className="plan-conflict-resolution">{conflict.resolution}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="plan-empty-note">No real clashes this trip — the group's swipes point the same way.</p>
                  )}
                </div>

                {groupProfile?.hard_constraints?.length > 0 && (
                  <div className="plan-block">
                    <div className="plan-block-title">Constraints we planned around</div>
                    <ul className="plan-constraints">
                      {groupProfile.hard_constraints.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {activeTab.startsWith("day-") && day && (
              <>
                <div className="plan-day-head">
                  <div>
                    <div className="plan-day-date">{dayLabel(day)}</div>
                    <div className="plan-day-title">{day.title}</div>
                    {plan?.rationale?.days?.[String(day.day_index)] && (
                      <div className="plan-day-rationale">
                        {plan.rationale.days[String(day.day_index)]}
                      </div>
                    )}
                  </div>
                  <div className="plan-mode-toggle" role="group" aria-label="Transport mode">
                    <button className={day.transport_mode === "walking" ? "sel" : ""} disabled={!currentDayEditable} onClick={() => setTransportMode("walking")}>Walk</button>
                    <button className={day.transport_mode === "driving" ? "sel" : ""} disabled={!currentDayEditable} onClick={() => setTransportMode("driving")}>Drive</button>
                  </div>
                </div>

                <RebuildBanner
                  info={rebuildInfo(day.day_index)}
                  capReached={rebuildCount(day.day_index) >= MAX_DAY_REBUILDS}
                  isLeader={isLeader}
                  credit={plan?.confirmed_by}
                  limit={MAX_DAY_REBUILDS}
                />

                <DayVoteBar
                  dayIndex={day.day_index}
                  votes={dayVotes}
                  members={members}
                  myId={profile?.id}
                  disabled={confirmed}
                  onVoteUp={(index) => castVote(index, "up")}
                  onVoteDown={openDownVote}
                />

                <DragDropProvider
                  sensors={DND_SENSORS}
                  onDragEnd={(event) => {
                    if (event.canceled) return;
                    const targetId = String(event.operation.target?.id || "").replace("drop:", "");
                    finishDrag(event.operation.source?.id, targetId);
                  }}
                >
                  <div className="timeline">
                    {day.stops.map((stop, index) => (
                      <ScheduledStop
                        key={stop.id}
                        stop={{ ...stop, transportMode: day.transport_mode }}
                        index={index}
                        total={day.stops.length}
                        open={open}
                        menuId={menuId}
                        setOpen={setOpen}
                        setMenuId={setMenuId}
                        onEdit={handleEdit}
                        editable={currentDayEditable}
                      />
                    ))}
                    {currentDayEditable && (
                      <button className="btn btn-secondary plan-add-stop" onClick={() => setSheetAction({ type: "add" })}>
                        + Add stop
                      </button>
                    )}
                    {day.overflow && (
                      <div className="plan-warning">
                        This day is packed past {day.endTime}. Remove a stop or shorten one to keep it comfortable.
                      </div>
                    )}
                  </div>
                  <DragOverlay>{(source) => {
                    const stop = day.stops.find((item) => item.id === source.id);
                    return stop ? <DragPreview stop={stop} /> : null;
                  }}</DragOverlay>
                </DragDropProvider>

                {confirmed && (
                  <SuggestionsPanel
                    suggestions={suggestions.filter((s) => s.day_index === day.day_index)}
                    members={members}
                    myId={profile?.id}
                    busy={busy}
                    onSuggest={() => setSuggestStep("type")}
                    onVote={submitSuggestionVote}
                  />
                )}
              </>
            )}

            {activeTab === "ideas" && (
              <div className="plan-ideas">
                <p className="plan-empty-note">
                  {confirmed
                    ? `Places the group liked that didn't make the itinerary. Suggest one for ${day ? dayLabel(day) : "a day"} and the group votes on it.`
                    : "Places the group liked that didn't make the itinerary. They join the plan when the group votes a day's rebuild."}
                </p>
                {unassigned.length === 0 && <p className="plan-empty-note">Every strong candidate made the plan.</p>}
                {unassigned.map((stop) => (
                  <div className="plan-idea" key={stop.card_id || stop.id}>
                    <img src={stop.img} alt={stop.name} referrerPolicy="no-referrer" />
                    <div className="plan-idea-main">
                      <div className="plan-idea-cat">{categoryLabel(stop.category)}</div>
                      <div className="plan-idea-name">{stop.name}</div>
                      <div className="plan-idea-area">{stop.area}</div>
                    </div>
                    {confirmed ? (
                      <button
                        className="btn btn-secondary btn-xs"
                        disabled={suggestBusy}
                        onClick={() => submitSuggestion("add", { stop })}
                      >
                        Suggest
                      </button>
                    ) : currentDayEditable ? (
                      <button className="btn btn-secondary btn-xs" disabled={busy} onClick={() => addIdeaToDay(stop)}>
                        Add
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="plan-confirm">
              {confirmed ? (
                <div className="plan-confirmed">
                  Confirmed by {plan?.confirmed_by || validated.confirmed_by || "the group"} · {new Date(plan?.confirmed_at || validated.confirmed_at).toLocaleDateString()}
                </div>
              ) : (
                <>
                  <div className="plan-vote-progress">
                    {approvedCount} of {days.length} {days.length === 1 ? "day" : "days"} approved · needs at least {majorityNeeded(memberCount)} of {memberCount} to vote
                  </div>
                  {isLeader ? (
                    <button
                      className="btn btn-primary btn-block"
                      disabled={!allDaysApproved || confirmBusy || days.length === 0}
                      onClick={confirmPlan}
                    >
                      {confirmBusy ? "Closing voting…" : "Close voting & confirm plan"}
                    </button>
                  ) : (
                    <div className="plan-empty-note">
                      Voting is open. The trip creator confirms once every day has a majority thumbs-up.
                    </div>
                  )}
                  {confirmError && <div className="plan-error" role="alert">{confirmError}</div>}
                </>
              )}
              {confirmed && (
                <div className="plan-pdf">
                  {pdfProgress && <p className="plan-empty-note">{pdfProgress}</p>}
                  {pdfError && <div className="plan-error" role="alert">{pdfError}</div>}
                </div>
              )}
            </div>
          </div>

          {busy && <div className="plan-routing" role="status">Re-routing…</div>}

          {undo && (
            <div className="plan-undo" role="status">
              <span>{undo.stop.name} removed</span>
              <button onClick={() => {
                // Reroute against the day that was edited, not whichever day is
                // open now: switching tabs inside the undo window must not
                // graft one day's stops onto another.
                const undoDay = days.find((d) => d.day_index === undo.dayIndex);
                applyStops(undo.dayIndex, undo.previousStops, {
                  keepOrder: true,
                  dayOverride: undoDay,
                  nextUnassigned: unassigned.filter((s) => s.card_id !== undo.stop.card_id),
                });
                setUndo(null);
              }}>Undo</button>
            </div>
          )}
        </>
      )}

      <BottomSheet open={Boolean(sheetAction)} onClose={() => setSheetAction(null)}>
        <h3>{sheetAction?.type === "replace" ? "Replace stop" : "Add a stop"}</h3>
        <p className="sub">
          Search Google Places. The route and times are recalculated with Mapbox after you choose.
        </p>
        <input className="addplace-input" autoFocus placeholder="Search places..." value={placeQuery} onChange={(event) => handlePlaceSearch(event.target.value)} />
        {placeError && <div className="addplace-error">{placeError}</div>}
        {placeLoading && <div className="addplace-status">Searching...</div>}
        {!placeLoading && placeResults.length > 0 && (
          <div className="addplace-results">
            {placeResults.map((place) => (
              <button key={place.placeId} className="addplace-result" onClick={() => applyPlace(place)}>
                <span className="apr-main">{place.mainText}</span>
                <span className="apr-sub">{place.secondaryText}</span>
              </button>
            ))}
          </div>
        )}
        {!placeLoading && placeResults.length === 0 && placeQuery.length >= 2 && !placeError && (
          <div className="addplace-status">No results found</div>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(voteSheet)} onClose={() => setVoteSheet(null)}>
        <h3>What's wrong with this day?</h3>
        <p className="sub">
          Your reasons steer the rebuild — the Itinerary Agent swaps stops to fix what the group flags.
        </p>
        <ReasonChips
          chips={reasonChips}
          selected={voteReasons}
          onToggle={(r) =>
            setVoteReasons((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
          }
        />
        <input
          className="reason-input"
          placeholder="Add a note (optional)"
          value={voteFree}
          onChange={(event) => setVoteFree(event.target.value)}
        />
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => setVoteSheet(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={submitDownVote}>
            Send to the group planner
          </button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={Boolean(suggestStep)}
        onClose={() => {
          setSuggestStep(null);
          setSuggestOld(null);
          setPlaceQuery("");
          setPlaceResults([]);
        }}
      >
        {suggestStep === "type" && (
          <>
            <h3>Suggest a change</h3>
            <p className="sub">The group votes. A majority applies the change and the route re-times itself.</p>
            <div className="suggest-types">
              <button onClick={() => setSuggestStep("add")}>Add a place</button>
              <button onClick={() => setSuggestStep("remove")}>Remove a place</button>
              <button onClick={() => setSuggestStep("replace-old")}>Replace a place</button>
            </div>
          </>
        )}

        {suggestStep === "add" && (
          <>
            <h3>Add a place to {day ? dayLabel(day) : "the day"}</h3>
            <p className="sub">Places the group liked that aren't in the plan yet.</p>
            {unassigned.length === 0 && <p className="plan-empty-note">No spare places left — try a search instead.</p>}
            {unassigned.map((stop) => (
              <button
                key={stop.card_id || stop.id}
                className="suggest-pick"
                disabled={suggestBusy}
                onClick={() => submitSuggestion("add", { stop })}
              >
                <span className="suggest-pick-name">{stop.name}</span>
                <span className="suggest-pick-meta">{stop.area}</span>
              </button>
            ))}
          </>
        )}

        {suggestStep === "remove" && day && (
          <>
            <h3>Remove a place from {dayLabel(day)}</h3>
            {day.stops.map((stop) => (
              <button
                key={stop.id}
                className="suggest-pick"
                disabled={suggestBusy}
                onClick={() => submitSuggestion("remove", { stop_id: stop.id || stop.card_id, name: stop.name })}
              >
                <span className="suggest-pick-name">{stop.name}</span>
                <span className="suggest-pick-meta">{stop.t} · {categoryLabel(stop.category)}</span>
              </button>
            ))}
          </>
        )}

        {suggestStep === "replace-old" && day && (
          <>
            <h3>Replace which place?</h3>
            {day.stops.map((stop) => (
              <button
                key={stop.id}
                className="suggest-pick"
                onClick={() => { setSuggestOld(stop); setSuggestStep("replace-search"); }}
              >
                <span className="suggest-pick-name">{stop.name}</span>
                <span className="suggest-pick-meta">{stop.t} · {categoryLabel(stop.category)}</span>
              </button>
            ))}
          </>
        )}

        {suggestStep === "replace-search" && (
          <>
            <h3>Replace {suggestOld?.name}</h3>
            <p className="sub">Search Google Places for the swap. The group votes before it lands.</p>
            <input
              className="addplace-input"
              autoFocus
              placeholder="Search places..."
              value={placeQuery}
              onChange={(event) => handlePlaceSearch(event.target.value)}
            />
            {placeError && <div className="addplace-error">{placeError}</div>}
            {placeLoading && <div className="addplace-status">Searching...</div>}
            {!placeLoading && placeResults.length > 0 && (
              <div className="addplace-results">
                {placeResults.map((place) => (
                  <button key={place.placeId} className="addplace-result" onClick={() => applyPlace(place)}>
                    <span className="apr-main">{place.mainText}</span>
                    <span className="apr-sub">{place.secondaryText}</span>
                  </button>
                ))}
              </div>
            )}
            {!placeLoading && placeResults.length === 0 && placeQuery.length >= 2 && !placeError && (
              <div className="addplace-status">No results found</div>
            )}
          </>
        )}
      </BottomSheet>
    </section>
  );
}
