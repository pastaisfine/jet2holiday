import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { DragDropProvider, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable } from "@dnd-kit/react";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { PLAN, ROUTE_LEGS } from "../data/plans";
import { HOTELS, FLIGHTS } from "../data/travel";
import BottomSheet from "../components/BottomSheet";
import InfiniteSpiral from "../components/InfiniteSpiral";
import { searchPlaces } from "../services/placesAutocomplete";
import Map, { Marker, Source, Layer, GeolocateControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getDirections } from '../services/mapbox';
import { ArrowSquareOut } from "@phosphor-icons/react";
import jsPDF from "jspdf";

const MODES = ["balanced", "foodfirst", "slower"];
const MODE_LABELS = { balanced: "Balanced", foodfirst: "Food-first", slower: "Slower pace" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DND_SENSORS = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Delay({ value: 300, tolerance: 8 })],
  }),
  KeyboardSensor,
];

function tagClass(tag) {
  if (tag.includes("4/4")) return "tag-ok";
  if (tag.includes("split") || tag.includes("2–2")) return "tag-split";
  return "tag-off";
}

function nextStopTime(stops) {
  const last = stops.at(-1)?.t;
  if (!last) return "09:00";
  const [hour, minute] = last.split(":").map(Number);
  const next = Math.min(hour * 60 + minute + 60, 23 * 60 + 59);
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

function isChronological(stops) {
  return stops.every((stop, index) => index === 0 || stop.t > stops[index - 1].t);
}

function reorderStops(stops, from, to) {
  const times = stops.map((stop) => stop.t);
  const next = [...stops];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((stop, index) => ({ ...stop, t: times[index] }));
}

const WalkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="13" cy="4" r="2" />
    <path d="m10 22 2-6-2-3 2-4 3 2 3 1M12 9l-3 2-2 4M14 16l4 6" />
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
        <div className="stop-tags">{stop.tags.map((tag) => <span key={tag} className={`chip ${tagClass(tag)}`}>{tag}</span>)}</div>
      </div>
    </div>
  );
}

function DroppableStop({ stop, index, stops, open, menuId, setOpen, setMenuId, setSheetAction, moveStop, removeStop, updateTime, locateOnMap }) {
  const { ref: draggableRef, handleRef, isDragSource } = useDraggable({ id: stop.id, type: "itinerary-stop" });
  const { ref: droppableRef, isDropTarget } = useDroppable({ id: `drop:${stop.id}`, accept: "itinerary-stop" });
  const leg = index < stops.length - 1 ? ROUTE_LEGS[`${stop.id}:${stops[index + 1].id}`] : null;

  return (
    <div className="timeline-item">
      <div ref={(element) => { draggableRef(element); droppableRef(element); }} className={`stoprow ${isDragSource ? "dragging" : ""} ${isDropTarget ? "drag-over" : ""}`} data-stop-id={stop.id}>
        <input className="stop-time" aria-label={`Arrival time for ${stop.name}`} type="time" value={stop.t} onChange={(event) => updateTime(stop.id, event.target.value)} />
        <div>
          <div className={`stop card ${open[stop.id] ? "open" : ""}`}>
            <div className="stop-top" onClick={() => setOpen((prev) => ({ ...prev, [stop.id]: !prev[stop.id] }))}>
              <button ref={handleRef} className="drag-handle" aria-label={`Long press to drag ${stop.name}`} onClick={(event) => event.stopPropagation()}>⠿</button>
              <span className="drag-hint">Long press to drag</span>
              <div className="th"><img src={stop.img} alt={`${stop.name} in Lisbon`} /></div>
              <div><div className="nm">{stop.name}</div><div className="ar">{stop.area}</div></div>
              <button className="stop-menu-button" aria-label={`Edit ${stop.name}`} onClick={(event) => { event.stopPropagation(); setMenuId(menuId === stop.id ? null : stop.id); }}>•••</button>
              <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
            </div>
            {menuId === stop.id && <div className="stop-menu" onClick={(event) => event.stopPropagation()}>
              <button onClick={() => { setSheetAction({ type: "replace", stopId: stop.id }); setMenuId(null); }}>Replace</button>
              <button disabled={index === 0} onClick={() => moveStop(stop.id, -1)}>Move earlier</button>
              <button disabled={index === stops.length - 1} onClick={() => moveStop(stop.id, 1)}>Move later</button>
              <button className="danger" onClick={() => removeStop(stop.id)}>Remove</button>
            </div>}
            <div className="exp">{stop.exp}</div>
            {stop.lng && stop.lat && (
              <button className="btn btn-secondary btn-block" style={{ marginTop: '12px' }} onClick={(e) => { e.stopPropagation(); locateOnMap(stop.lng, stop.lat); }}>View on map</button>
            )}
          </div>
          <div className="stop-tags">{stop.tags.map((tag) => <span key={tag} className={`chip ${tagClass(tag)}`}>{tag}</span>)}</div>
        </div>
      </div>
      {index < stops.length - 1 && <div className={`route-leg ${leg ? "" : "unavailable"}`}><WalkIcon />{leg ? <span>{leg.distance} · Walk {leg.duration}</span> : <span>Route details unavailable</span>}</div>}
    </div>
  );
}

export default function PlanScreen({ useAppState }) {
  const navigate = useNavigate();
  const {
    mode,
    markPlanSeen,
    hotel,
    flight,
    startDate,
    endDate,
    activeItinerary,
    activeStops,
    isItineraryDirty,
    userSuggestedItineraries,
    selectItinerary,
    setItineraryStops,
    discardItineraryDraft,
    saveItinerarySnapshot,
    deleteSuggestedItinerary,
    restoreSuggestedItinerary,
    itineraryVotes,
    confirmedItineraryId,
    castVote,
    confirmItinerary,
  } = useAppState;
  const [open, setOpen] = useState({});
  const [menuId, setMenuId] = useState(null);
  const [sheetAction, setSheetAction] = useState(null);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState([]);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [timeError, setTimeError] = useState("");
  const [undoStop, setUndoStop] = useState(null);
  const [undoItinerary, setUndoItinerary] = useState(null);
  const debounceRef = useRef(null);

  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const [routeGeometry, setRouteGeometry] = useState(null);

  useEffect(() => {
    const coords = activeStops.filter((s) => s.lng && s.lat);
    if (coords.length >= 2) {
      getDirections(coords).then(setRouteGeometry);
    } else {
      setRouteGeometry(null);
    }
  }, [activeStops]);

  const handleLocateOnMap = (lng, lat) => {
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [lng, lat], zoom: 15, duration: 1500 });
    }
    if (mapContainerRef.current) {
      mapContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const planDay = useMemo(() => {
    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      return new Date((s.getTime() + e.getTime()) / 2);
    }
    return new Date(2025, 3, 25);
  }, [startDate, endDate]);

  const baseMode = activeItinerary.baseMode || (PLAN[activeItinerary.id] ? activeItinerary.id : mode);
  const plan = PLAN[baseMode] || PLAN.balanced;
  const hotelPicked = typeof hotel === "object" && hotel ? hotel : HOTELS.find((h) => h.id === hotel);
  const flightPicked = typeof flight === "object" && flight ? flight : FLIGHTS.find((f) => f.id === flight);

  const getShortHotelName = (name) => {
    if (!name) return "";

    const lower = name.toLowerCase();

    if (lower.includes("doubletree")) return "DoubleTree";
    if (lower.includes("costa mahkota")) return "Costa Mahkota";
    if (lower.includes("casa del rio")) return "Casa Del Rio";
    if (lower.includes("twc luxury")) return "TWC Luxury";

    return name.split(" ").slice(0, 2).join(" ");
  };


  const allItineraries = [
    ...MODES.map((id) => ({ id, label: MODE_LABELS[id], kind: "default" })),
    ...userSuggestedItineraries,
  ];
  const itineraries = confirmedItineraryId
    ? allItineraries.filter(i => i.id === confirmedItineraryId)
    : allItineraries;
  const spiralItems = useMemo(
    () => activeStops.map((stop) => ({ id: stop.id, src: stop.img, alt: stop.name })),
    [activeStops],
  );

  function formatTime(time24) {
    if (!time24) return "No time";

    const [hour, minute] = time24.split(":");
    let h = parseInt(hour, 10);

    const ampm = h >= 12 ? "PM" : "AM";

    h = h % 12;
    if (h === 0) h = 12;

    return `${h}:${minute} ${ampm}`;
  }

  const downloadItineraryPDF = (itinerary) => {
    console.log("PDF button clicked");
    const doc = new jsPDF();

    // HEADER
    doc.setFillColor(34, 197, 94);
    doc.rect(0, 0, 210, 35, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text("Travel Itinerary", 105, 16, { align: "center" });

    doc.setFontSize(12);
    doc.text(
      `${activeItinerary?.name || "Trip Plan"}`,
      105,
      25,
      { align: "center" }
    );

    let y = 50;

    activeStops.forEach((stop, index) => {

      // card background
      doc.setFillColor(242, 246, 252);
      doc.roundedRect(15, y - 4, 180, 26, 3, 3, "F");

      // stop number
      doc.setFillColor(30, 64, 175);
      doc.circle(25, y + 6, 5, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text(String(index + 1), 24, y + 8);

      // time
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(11);
      doc.text(formatTime(stop.t), 38, y + 4);

      // location
      doc.setFontSize(15);
      doc.setFont(undefined, "bold");
      doc.text(stop.name, 38, y + 12);

      // subtitle
      if (stop.subtitle) {
        doc.setFont(undefined, "normal");
        doc.setFontSize(10);
        doc.setTextColor(120, 120, 120);
        doc.text(stop.subtitle, 38, y + 19);
      }

      y += 35;

      if (y > 250) {
        doc.addPage();
        y = 20;
      }

    }); // closes forEach

    doc.save(`${itinerary.name || "itinerary"}.pdf`);

  }; // closes function


  useEffect(() => {
    markPlanSeen();
  }, [markPlanSeen]);

  useEffect(() => {
    if (!isItineraryDirty) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isItineraryDirty]);

  useEffect(() => {
    if (!isItineraryDirty) return undefined;
    const confirmLinkNavigation = (event) => {
      const link = event.target.closest("a[href]");
      if (!link || link.target || link.download || event.metaKey || event.ctrlKey) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;
      if (!window.confirm("Discard unsaved itinerary edits?")) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      discardItineraryDraft(activeItinerary.id);
    };
    document.addEventListener("click", confirmLinkNavigation, true);
    return () => document.removeEventListener("click", confirmLinkNavigation, true);
  }, [activeItinerary.id, discardItineraryDraft, isItineraryDirty]);

  useEffect(() => {
    if (!undoStop && !undoItinerary) return undefined;
    const timeout = window.setTimeout(() => {
      setUndoStop(null);
      setUndoItinerary(null);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [undoStop, undoItinerary]);

  const updateStops = (nextStops) => {
    setItineraryStops(activeItinerary.id, nextStops);
    if (timeError && isChronological(nextStops)) setTimeError("");
  };

  const requestItineraryChange = (id) => {
    if (id === activeItinerary.id) return;
    if (isItineraryDirty && !window.confirm("Discard unsaved itinerary edits?")) return;
    if (isItineraryDirty) discardItineraryDraft(activeItinerary.id);
    setOpen({});
    setMenuId(null);
    setTimeError("");
    selectItinerary(id);
  };
  const saveSnapshot = () => {
    if (!isChronological(activeStops)) {
      setTimeError("Arrival times must be in chronological order before saving.");
      return;
    }
    setTimeError("");
    saveItinerarySnapshot(activeItinerary.id);
  };

  const navigateAway = (path) => {
    if (isItineraryDirty && !window.confirm("Discard unsaved itinerary edits?")) return;
    if (isItineraryDirty) discardItineraryDraft(activeItinerary.id);
    navigate(path);
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

  const applyPlace = (place) => {
    const replaced = sheetAction?.type === "replace";
    const oldStop = activeStops.find((stop) => stop.id === sheetAction?.stopId);
    const stop = {
      id: `user-${place.placeId}-${activeStops.filter((item) => item.id.startsWith(`user-${place.placeId}-`)).length + 1}`,
      t: replaced ? oldStop.t : nextStopTime(activeStops),
      name: place.mainText,
      area: place.secondaryText || "Custom location",
      tags: ["User-added"],
      img: place.mapImageUrl || "/images/alfama.jpg",
      exp: place.description || "Added by you.",
      userAdded: true,
    };
    if (replaced) {
      updateStops(activeStops.map((item) => (item.id === oldStop.id ? stop : item)));
    } else {
      updateStops([...activeStops, stop]);
    }
    setSheetAction(null);
    setPlaceQuery("");
    setPlaceResults([]);
  };

  const removeStop = (id) => {
    const index = activeStops.findIndex((stop) => stop.id === id);
    if (index < 0) return;
    setUndoStop({ stop: activeStops[index], index, itineraryId: activeItinerary.id });
    updateStops(activeStops.filter((stop) => stop.id !== id));
    setMenuId(null);
  };

  const moveStop = (id, direction) => {
    const index = activeStops.findIndex((stop) => stop.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= activeStops.length) return;
    updateStops(reorderStops(activeStops, index, target));
    setMenuId(null);
  };

  const finishDrag = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const from = activeStops.findIndex((stop) => stop.id === sourceId);
    const to = activeStops.findIndex((stop) => stop.id === targetId);
    if (from >= 0 && to >= 0) {
      updateStops(reorderStops(activeStops, from, to));
    }
  };

  const updateTime = (id, t) => updateStops(activeStops.map((stop) => (stop.id === id ? { ...stop, t } : stop)));

  const deleteItinerary = (itinerary) => {
    const index = userSuggestedItineraries.findIndex((item) => item.id === itinerary.id);
    deleteSuggestedItinerary(itinerary.id);
    setUndoItinerary({ itinerary, index });
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
        <div className="eyebrow">{DAYS[planDay.getDay()]} · {MONTHS_SHORT[planDay.getMonth()]} {planDay.getDate()}</div>
        <div className="day">The shared plan</div>
      </div>

      <div className="plan-cards">
        <div ref={mapContainerRef} className="map-bento-card bento-card" style={{ padding: 0, overflow: 'hidden', height: '240px', position: 'relative' }}>
          <Map
            ref={mapRef}
            initialViewState={{
              longitude: -9.1393,
              latitude: 38.7138,
              zoom: 12
            }}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
          >
            <GeolocateControl
              position="top-right"
              positionOptions={{
                enableHighAccuracy: true
              }}
              trackUserLocation={true}
              showUserHeading={true}
            />

            {activeStops.map(stop => stop.lng && stop.lat ? (
              <Marker key={stop.id} longitude={stop.lng} latitude={stop.lat} color="#C49B28" />
            ) : null)}
            {routeGeometry && (
              <Source id="route" type="geojson" data={routeGeometry}>
                <Layer
                  id="route-line"
                  type="line"
                  layout={{
                    "line-join": "round",
                    "line-cap": "round"
                  }}
                  paint={{
                    "line-color": "#2D483A",
                    "line-width": 4,
                    "line-opacity": 0.9
                  }}
                />
              </Source>
            )}
          </Map>
        </div>

        <div className="bento-card">
          <div className="bx-title">Trip basics · you're the leader</div>
          <div className="tl-picks">

            <div className="tl-pick">
              <span className="lbl">Stay</span>

              <span className="val">
                {hotelPicked
                  ? `${getShortHotelName(hotelPicked.name)} · ${hotelPicked.price}`
                  : "none picked"}
              </span>

              {hotelPicked && (
                <button
                  className="book-now-btn"
                  onClick={() =>
                    window.open(
                      `https://www.google.com/travel/search?q=${encodeURIComponent(hotelPicked.name)}`,
                      "_blank"
                    )
                  }
                >
                  <ArrowSquareOut size={16} weight="regular" />
                  <span>Book now!</span>
                </button>
              )}
            </div>

            <div className="tl-pick">
              <span className="lbl">Flight</span>

              <span className="val">
                {flightPicked
                  ? `${flightPicked.name} · ${flightPicked.price}`
                  : "none picked"}
              </span>

              {flightPicked && (
                <button
                  className="book-now-btn"
                  onClick={() =>
                    window.open(
                      `https://www.google.com/travel/flights?q=${encodeURIComponent(
                        flightPicked.name
                      )}`,
                      "_blank"
                    )
                  }
                >
                  <ArrowSquareOut size={16} weight="regular" />
                  <span>Book now!</span>
                </button>
              )}
            </div>

          </div>

          <button className="btn btn-primary btn-block" onClick={() => navigateAway("/travel")}>Set trip basics →</button>
        </div>


        <div className="whatif bento-card">
          <div className="bx-title">Itineraries</div>
          <div className="itinerary-tabs" role="tablist" aria-label="Itineraries">
            {itineraries.map((itinerary) => (
              <div className="itinerary-tab-wrap" key={itinerary.id}>
                <button role="tab" aria-selected={activeItinerary.id === itinerary.id} className={`itinerary-tab ${activeItinerary.id === itinerary.id ? "sel" : ""}`} onClick={() => requestItineraryChange(itinerary.id)}>{itinerary.label}</button>
                {itinerary.kind === "suggested" && <button className="itinerary-delete" aria-label={`Delete ${itinerary.label}`} onClick={() => deleteItinerary(itinerary)}>×</button>}
              </div>
            ))}
          </div>
          {confirmedItineraryId ? (
            <div className="plan-draft" style={{ color: '#2b8a3e', marginTop: '12px', fontWeight: 'bold' }}>✓ This plan is confirmed</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => castVote(activeItinerary.id)}>
                  Vote ({itineraryVotes[activeItinerary.id] || 0})
                </button>
                {((itineraryVotes[activeItinerary.id] || 0) > 0 && (itineraryVotes[activeItinerary.id] || 0) === Math.max(0, ...Object.values(itineraryVotes))) && (
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => confirmItinerary(activeItinerary.id)}>
                    Confirm Plan
                  </button>
                )}
              </div>
              <button className="btn btn-secondary btn-block plan-save" onClick={saveSnapshot} style={{ marginTop: '8px' }}>Save as user-suggested</button>
            </>
          )}
          {isItineraryDirty && <span className="plan-draft">Unsaved edits</span>}
          {timeError && <div className="plan-error" role="alert">{timeError}</div>}
        </div>

        <div className={`delta ${plan.delta ? "show" : ""}`}><b>What changed:</b> <span dangerouslySetInnerHTML={{ __html: plan.delta }} /></div>
      </div>

      <DragDropProvider sensors={DND_SENSORS} onDragEnd={(event) => {
        if (event.canceled) return;
        const targetId = String(event.operation.target?.id || "").replace("drop:", "");
        finishDrag(event.operation.source?.id, targetId);
      }}>
        <div className="timeline">
          {activeStops.map((stop, index) => <DroppableStop key={stop.id} stop={stop} index={index} stops={activeStops} open={open} menuId={menuId} setOpen={setOpen} setMenuId={setMenuId} setSheetAction={setSheetAction} moveStop={moveStop} removeStop={removeStop} updateTime={updateTime} locateOnMap={handleLocateOnMap} />)}
          <button className="btn btn-secondary plan-add-stop" onClick={() => setSheetAction({ type: "add" })}>+ Add stop</button>
          {confirmedItineraryId === activeItinerary?.id && (
            <button
              className="save-pdf-btn"
              onClick={() => downloadItineraryPDF(activeItinerary)}
            >
              Save as PDF
            </button>
          )}
        </div>
        <DragOverlay>{(source) => {
          const stop = activeStops.find((item) => item.id === source.id);
          return stop ? <DragPreview stop={stop} /> : null;
        }}</DragOverlay>
      </DragDropProvider>

      <div className="why-head"><h3>Why this way?</h3></div>
      <details className="why-note"><summary>Negotiation notes</summary><div className="bullets"><ul style={{ margin: 0, paddingLeft: 18 }}>{plan.why.map((why, index) => <li key={index} style={{ marginBottom: 8 }} dangerouslySetInnerHTML={{ __html: why }} />)}</ul></div></details>

      <BottomSheet open={Boolean(sheetAction)} onClose={() => setSheetAction(null)}>
        <h3>{sheetAction?.type === "replace" ? "Replace stop" : "Add a stop"}</h3>
        <p className="sub">Search Google Places. Added stops are labelled as user-added rather than receiving generated consensus claims.</p>
        <input className="addplace-input" autoFocus placeholder="Search places..." value={placeQuery} onChange={(event) => handlePlaceSearch(event.target.value)} />
        {placeError && <div className="addplace-error">{placeError}</div>}
        {placeLoading && <div className="addplace-status">Searching...</div>}
        {!placeLoading && placeResults.length > 0 && <div className="addplace-results">{placeResults.map((place) => <button key={place.placeId} className="addplace-result" onClick={() => applyPlace(place)}><span className="apr-main">{place.mainText}</span><span className="apr-sub">{place.secondaryText}</span></button>)}</div>}
        {!placeLoading && placeResults.length === 0 && placeQuery.length >= 2 && !placeError && <div className="addplace-status">No results found</div>}
      </BottomSheet>

      {
        (undoStop || undoItinerary) && <div className="plan-undo" role="status"><span>{undoStop ? `${undoStop.stop.name} removed` : `${undoItinerary.itinerary.label} deleted`}</span><button onClick={() => {
          if (undoStop && undoStop.itineraryId === activeItinerary.id) {
            const next = [...activeStops];
            next.splice(undoStop.index, 0, undoStop.stop);
            updateStops(next);
          }
          if (undoItinerary) restoreSuggestedItinerary(undoItinerary.itinerary, undoItinerary.index);
          setUndoStop(null);
          setUndoItinerary(null);
        }}>Undo</button></div>
      }
    </section >
  );
}