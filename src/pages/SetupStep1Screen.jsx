import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobeHemisphereWest, CalendarBlank } from "phosphor-react";
import { searchPlaces } from "../services/placesAutocomplete";
import ProgressBar from "../components/ProgressBar";
import { parseTripDate, todayInputValue } from "../utils/date";

export default function SetupStep1Screen({ useAppState }) {
  const navigate = useNavigate();
  const {
    setDest: saveDest,
    setDates,
    dest: savedDest,
    startDate: savedStart,
    endDate: savedEnd,
    pipelineCompleted,
    pipelineDest,
  } = useAppState;

  const destLocked = Boolean(pipelineCompleted && pipelineDest);

  const [dest, setDest] = useState(savedDest || "");
  const [startDate, setStartDate] = useState(savedStart ? savedStart.slice(0, 10) : "");
  const [endDate, setEndDate] = useState(savedEnd ? savedEnd.slice(0, 10) : "");
  const [destSuggestions, setDestSuggestions] = useState([]);
  const [destSearching, setDestSearching] = useState(false);
  const [showDestSuggestions, setShowDestSuggestions] = useState(false);
  const [error, setError] = useState("");
  const destDebounceRef = useRef(null);
  const destSuggestionsOpen = showDestSuggestions && destSuggestions.length > 0 && !destLocked;

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

  const handleNext = () => {
    if (!dest.trim()) {
      setError("Please enter a destination.");
      return;
    }
    setError("");
    saveDest(dest.trim());
    setDates(
      startDate ? parseTripDate(startDate).toISOString() : null,
      endDate ? parseTripDate(endDate).toISOString() : null,
    );
    navigate("/setup/step2");
  };

  return (
    <section className="screen active screen-setup">
      {/* Progress */}
      <div style={{ padding: "4px 4px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <ProgressBar value={33} />
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 10, whiteSpace: "nowrap" }}>1 / 3</span>
        </div>
      </div>

      {/* Where to */}
      <div style={{ padding: "12px 4px 0" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 26, fontWeight: 800, color: "var(--fg)", letterSpacing: "-0.03em" }}>
          Where to?
        </h1>

        <div
          className="bento-card"
          style={{ padding: 16, overflow: destSuggestionsOpen ? "visible" : "hidden", zIndex: destSuggestionsOpen ? 20 : undefined }}
        >
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", pointerEvents: "none", color: "var(--accent)" }}>
              <GlobeHemisphereWest size={20} weight="duotone" />
            </span>
            <input
              className="input"
              value={dest}
              onChange={(e) => handleDestChange(e.target.value)}
              onFocus={() => destSuggestions.length > 0 && setShowDestSuggestions(true)}
              onBlur={() => setTimeout(() => setShowDestSuggestions(false), 150)}
              placeholder="Enter your destination"
              disabled={destLocked}
              style={{ paddingLeft: 42, height: 52, width: "100%", borderRadius: 16, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", fontSize: 15, opacity: destLocked ? 0.6 : 1 }}
            />
            {destSuggestionsOpen && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", zIndex: 30, boxShadow: "var(--shadow-lift)" }}>
                {destSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.placeId}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); pickDestination(suggestion); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", borderBottom: "1px solid var(--border)", color: "var(--fg)", fontSize: 14, cursor: "pointer" }}
                  >
                    {suggestion.mainText || suggestion.description}
                  </button>
                ))}
              </div>
            )}
          </div>
          {destLocked && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
              Trip generated for {pipelineDest} — reset from Profile to start over.
            </div>
          )}
          {destSearching && !destLocked && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Searching destinations…</div>
          )}
        </div>
      </div>

      {/* How long */}
      <div style={{ padding: "20px 4px 0" }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 26, fontWeight: 800, color: "var(--fg)", letterSpacing: "-0.03em" }}>
          How long?
        </h1>

        <div className="bento-card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ display: "flex", alignItems: "center", color: "var(--muted)", flexShrink: 0 }}>
              <CalendarBlank size={20} weight="regular" />
            </span>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="date"
                value={startDate}
                min={todayInputValue()}
                onChange={(e) => { setStartDate(e.target.value); if (endDate && e.target.value > endDate) setEndDate(""); }}
                style={{ flex: 1, height: 44, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg)", color: startDate ? "var(--fg)" : "var(--muted)", padding: "0 10px", fontSize: 14, minWidth: 0 }}
              />
              <span style={{ color: "var(--muted)", fontSize: 14, flexShrink: 0 }}>–</span>
              <input
                type="date"
                value={endDate}
                min={startDate || todayInputValue()}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ flex: 1, height: 44, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg)", color: endDate ? "var(--fg)" : "var(--muted)", padding: "0 10px", fontSize: 14, minWidth: 0 }}
              />
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, paddingLeft: 32 }}>
            Optional — but your dates set how many places we find, so a single day gets a
            short list and a week gets a long one.
          </div>
        </div>
      </div>

      {error && (
        <div style={{ margin: "10px 4px 0", padding: "10px 14px", background: "var(--nom-soft)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 13, color: "var(--nom)" }}>
          {error}
        </div>
      )}

      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 24 }}
        onClick={handleNext}
      >
        Next →
      </button>
    </section>
  );
}
