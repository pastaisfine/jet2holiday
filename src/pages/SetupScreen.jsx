import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Crown } from "phosphor-react";
import { useAuth } from "../context/useAuth";
import { dayCount } from "../utils/date";
import BottomSheet from "../components/BottomSheet";
import PreferenceForm, { EMPTY_PREFERENCES } from "../components/PreferenceForm";
import { normaliseStoredPreferences } from "../lib/preferenceProfile";
import { searchPlaces } from "../services/placesAutocomplete";
import { createOrUpdateTrip } from "../services/tripService";
import { resetPipeline, startPipeline } from "../services/generateTrip";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);
const isSameDay = (left, right) => left && right && left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
const isBetween = (date, start, end) => date > start && date < end;
const fmtShort = (date) => `${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`;
const fmtDay = (date) => DAYS[(date.getDay() + 6) % 7];

function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const cells = Array((first.getDay() + 6) % 7).fill(null);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
  return cells;
}

export default function SetupScreen({ useAppState }) {
  const navigate = useNavigate();
  const { profile, session } = useAuth();
  const [dest, setDest] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const today = useMemo(() => { const date = new Date(); date.setHours(0, 0, 0, 0); return date; }, []);
  const [calMonth, setCalMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const { setDest: saveDest, setDates, setTripId, startDate: savedStart, endDate: savedEnd, pipelineCompleted, pipelineDest, tripId } = useAppState;
  const { preferenceProfiles, savePreferenceProfile } = useAppState;
  const preferenceId = profile?.id || profile?.username || "guest";
  const [preferenceOpen, setPreferenceOpen] = useState(false);
  const [preferences, setPreferences] = useState(() => normaliseStoredPreferences({ ...EMPTY_PREFERENCES, ...preferenceProfiles?.[preferenceId], dietary: preferenceProfiles?.[preferenceId]?.dietary || [] }));
  const [localStart, setLocalStart] = useState(() => savedStart ? new Date(savedStart) : null);
  const [localEnd, setLocalEnd] = useState(() => savedEnd ? new Date(savedEnd) : null);
  const [destSuggestions, setDestSuggestions] = useState([]);
  const [destSearching, setDestSearching] = useState(false);
  const [showDestSuggestions, setShowDestSuggestions] = useState(false);
  const destDebounceRef = useRef(null);
  const destLocked = Boolean(pipelineCompleted && pipelineDest);
  const destSuggestionsOpen = showDestSuggestions && destSuggestions.length > 0 && !destLocked;
  const grid = useMemo(() => buildMonthGrid(calMonth.getFullYear(), calMonth.getMonth()), [calMonth]);
  const startDate = localStart;
  const endDate = localEnd;
  const link = tripId
    ? `${window.location.origin}/join/${tripId}`
    : `${window.location.origin}/join/(create trip first)`;
  const scheduleDays = useMemo(() => {
    if (!startDate || !endDate) return [];
    const days = [];
    const current = new Date(startDate);
    while (current <= endDate) { days.push(new Date(current)); current.setDate(current.getDate() + 1); }
    return days;
  }, [startDate, endDate]);

  const handleDayClick = (date) => {
    if (date < today) return;
    if (!localStart || localEnd) { setLocalStart(date); setLocalEnd(null); setDates(null, null); }
    else if (date < localStart) { setLocalEnd(localStart); setLocalStart(date); setDates(date.toISOString(), localStart.toISOString()); }
    else { setLocalEnd(date); setDates(localStart.toISOString(), date.toISOString()); }
  };
  const clearDates = () => { setLocalStart(null); setLocalEnd(null); setDates(null, null); };
  const summary = () => !startDate ? "Pick your dates on the calendar" : !endDate ? `${fmtShort(startDate)} - pick an end date` : `${fmtShort(startDate)} to ${fmtShort(endDate)} - ${dayCount(startDate, endDate) - 1} night${dayCount(startDate, endDate) === 2 ? "" : "s"}`;
  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setCopied(false); }
  };
  const handleDestChange = (value) => {
    setDest(value);
    if (destDebounceRef.current) clearTimeout(destDebounceRef.current);
    if (value.trim().length < 2) {
      setDestSuggestions([]);
      setShowDestSuggestions(false);
      setDestSearching(false);
      return;
    }
    destDebounceRef.current = setTimeout(async () => {
      setDestSearching(true);
      try {
        const results = await searchPlaces(value);
        setDestSuggestions(results.slice(0, 6));
        setShowDestSuggestions(true);
      } catch {
        setDestSuggestions([]);
        setShowDestSuggestions(false);
      } finally {
        setDestSearching(false);
      }
    }, 350);
  };

  const pickDestination = (suggestion) => {
    setDest(suggestion.mainText || suggestion.description || "");
    setDestSuggestions([]);
    setShowDestSuggestions(false);
  };

  const continueToSwipe = async (skipped = false) => {
    savePreferenceProfile(preferenceId, { ...preferences, completed: !skipped, skipped });
    const finalDest = dest.trim() || "Lisbon, Portugal";
    saveDest(finalDest);
    setPreferenceOpen(false);

    // Q27c/Q34: pipeline requires an authenticated session
    if (!session) {
      navigate("/login", { state: { returnTo: "/setup" } });
      return;
    }

    // Persist trip row and capture real trip UUID for invite link
    let createdTripId = tripId;
    try {
      const trip = await createOrUpdateTrip({
        tripId: tripId || undefined,
        destination: finalDest,
        startDate: localStart,
        endDate: localEnd,
        leaderId: session.user.id,
      });
      if (trip?.id) {
        createdTripId = trip.id;
        setTripId(trip.id);
      }
    } catch {
      // non-blocking — continue to swipe even if DB write fails
    }

    useAppState.update({
      idx: 0,
      likes: 0,
      skips: 0,
      addedCards: [],
      cardsDeckId: null,
      pipelineCompleted: false,
      pipelineDest: finalDest,
      pipelineThinFallback: false,
      pipelineFailureCode: null,
      tripId: createdTripId || tripId || null,
    });

    resetPipeline();
    // Deliberately not awaited: a cache hit resolves in a single query, and a
    // miss resolves once the claim is recorded. Either way the deck is being
    // watched over Realtime, so navigating now is correct rather than waiting.
    startPipeline({
      destination: finalDest,
      startDate: localStart ? localStart.toISOString() : null,
      endDate: localEnd ? localEnd.toISOString() : null,
      preferences,
      tripId: createdTripId || tripId || null,
    });

    navigate("/swipe");
  };
  const toggleDietary = (option) => setPreferences((current) => { const dietary = current.dietary || []; if (option === "None") return { ...current, dietary: dietary.includes("None") ? [] : ["None"] }; return { ...current, dietary: [...dietary.filter((item) => item !== "None"), ...(dietary.includes(option) ? [] : [option])] }; });

  return (
    <section className="screen active screen-setup">
      {/* Top Title */}
      <div style={{ padding: "4px 4px 0" }}>
        <div className="eyebrow" style={{ color: "var(--muted)" }}>Trip Planning</div>
        <h1 style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 800, color: "var(--fg)", letterSpacing: "-0.03em" }}>
          Where to, crew?
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--muted)" }}>
          Set the destination, pick dates, and invite your travel companions.
        </p>
      </div>

      {/* 1. Destination Card */}
      <div
        className="bento-card"
        style={{ padding: 20, overflow: destSuggestionsOpen ? "visible" : "hidden", zIndex: destSuggestionsOpen ? 20 : undefined }}
      >
        <label style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg)" }}>
          Destination
        </label>
        <div style={{ position: "relative" }}>
          <input
            className="input"
            value={dest}
            onChange={(event) => handleDestChange(event.target.value)}
            onFocus={() => destSuggestions.length > 0 && setShowDestSuggestions(true)}
            onBlur={() => setTimeout(() => setShowDestSuggestions(false), 150)}
            placeholder="e.g. Jeju, South Korea"
            disabled={destLocked}
            style={{ marginTop: 4, height: 48, width: "100%", borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", padding: "0 14px", fontSize: 15, opacity: destLocked ? 0.6 : 1 }}
          />
          {destSuggestionsOpen && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", zIndex: 30, boxShadow: "0 8px 24px rgba(0,0,0,0.18)" }}>
              {destSuggestions.map((suggestion) => (
                <button
                  key={suggestion.placeId}
                  type="button"
                  onMouseDown={(event) => { event.preventDefault(); pickDestination(suggestion); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", borderBottom: "1px solid var(--border)", color: "var(--fg)", fontSize: 14, cursor: "pointer" }}
                >
                  {suggestion.mainText || suggestion.description}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          {destLocked
            ? `Trip generated for ${pipelineDest} — reset from Profile to start over.`
            : destSearching
              ? "Searching destinations…"
              : "Search a city or region — recommendations adapt to your destination"}
        </div>
      </div>

      {/* 2. Calendar / Dates Card */}
      <div className="bento-card" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg)" }}>
            Dates
          </label>
          {(startDate || endDate) && (
            <button
              onClick={clearDates}
              style={{ background: "none", border: "none", color: "var(--nom)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}
            >
              Clear
            </button>
          )}
        </div>

        <div className="cal-wrap" style={{ width: "100%", margin: "10px 0 4px" }}>
          <div className="cal-nav" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <button className="cal-navbtn" onClick={() => setCalMonth(addMonths(calMonth, -1))} disabled={calMonth <= today} style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", cursor: "pointer" }}>‹</button>
            <span className="cal-title" style={{ fontWeight: 700, fontSize: 14, color: "var(--fg)" }}>{MONTHS[calMonth.getMonth()]} {calMonth.getFullYear()}</span>
            <button className="cal-navbtn" onClick={() => setCalMonth(addMonths(calMonth, 1))} style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", cursor: "pointer" }}>›</button>
          </div>
          <div className="cal-grid">
            {DAYS.map((day) => <div key={day} className="cal-head" style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>{day}</div>)}
            {grid.map((date, index) => {
              if (!date) return <div key={`empty-${index}`} className="cal-day empty" />;
              const past = date < today;
              const className = ["cal-day", past && "disabled", isSameDay(date, startDate) && "start", isSameDay(date, endDate) && "end", startDate && endDate && isBetween(date, startDate, endDate) && "in-range"].filter(Boolean).join(" ");
              return <button key={index} className={className} onClick={() => handleDayClick(date)} disabled={past}>{date.getDate()}</button>;
            })}
          </div>
        </div>

        <div
          style={{
            marginTop: 8,
            padding: "10px 14px",
            background: "var(--bg)",
            borderRadius: 14,
            border: "1px solid var(--border)",
            fontSize: 13,
            fontWeight: 500,
            color: "var(--fg)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
          }}
          onClick={() => setScheduleOpen((open) => !open)}
        >
          <span>{summary()}</span>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>{scheduleOpen ? "▲" : "▼"}</span>
        </div>

        {scheduleOpen && scheduleDays.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, padding: 12, background: "var(--bg)", borderRadius: 14 }}>
            {scheduleDays.map((date) => (
              <div key={date.toISOString()} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--fg)" }}>
                <span>{fmtShort(date)}</span>
                <span style={{ fontWeight: 600, color: "var(--muted)" }}>{fmtDay(date).toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Invite Crew Card */}
      <div className="bento-card" style={{ padding: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg)" }}>
          Invite your crew
        </label>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 12px", lineHeight: 1.5 }}>
          Share the link below. Friends sign up or sign in to join your workspace and start swiping the same places.
        </p>

        {/* Current user (you) */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--bg)", borderRadius: 16, border: "1px solid var(--border)", marginBottom: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#F19A6A", color: "var(--surface)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12 }}>
            {(profile?.username || "You").slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>
              {profile?.username || "You"}{" "}
              <span style={{ fontSize: 10, background: "var(--fg)", color: "var(--surface)", padding: "2px 6px", borderRadius: 999, marginLeft: 4 }}>you · leader</span>
            </div>
          </div>
          <Crown size={18} weight="fill" color="var(--accent)" title="Trip leader" />
        </div>

        {/* Invite link */}
        <button
          className="btn btn-secondary btn-block"
          style={{ marginTop: 4 }}
          onClick={() => setInviteOpen((open) => !open)}
        >
          {copied ? "Link Copied to Clipboard!" : "Share Invite Link"}
        </button>

        {inviteOpen && (
          <div style={{ marginTop: 10, padding: 14, background: "var(--bg)", borderRadius: 16, border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {tripId ? "Anyone with this link lands directly in your trip workspace." : "Create your trip first — the invite link will appear here."}
            </div>
            {tripId && (
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" readOnly value={link} style={{ flex: 1, fontSize: 11, padding: "0 10px", height: 38, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)" }} />
                <button className="btn btn-primary" style={{ minHeight: 38, padding: "0 14px", fontSize: 13 }} onClick={copyInvite}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 8 }}
        onClick={() => (destLocked ? navigate("/hub") : setPreferenceOpen(true))}
      >
        {destLocked ? "Trip generated ✓" : "Create trip & invite group →"}
      </button>

      <BottomSheet open={preferenceOpen} onClose={() => continueToSwipe(true)} className="preference-sheet">
        <PreferenceForm preferences={preferences} onChange={(key, value) => setPreferences((current) => ({ ...current, [key]: value }))} onDietaryToggle={toggleDietary} onSkip={() => continueToSwipe(true)} onSave={() => continueToSwipe(false)} />
      </BottomSheet>
    </section>
  );
}
