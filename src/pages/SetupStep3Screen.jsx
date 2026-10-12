import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Baby,
  PersonSimpleWalk,
  Wheelchair,
  Leaf,
  CurrencyDollar,
  Moon,
  Peace,
  Sparkle,
  Star,
} from "phosphor-react";
import { useAuth } from "../context/useAuth";
import ProgressBar from "../components/ProgressBar";
import { EMPTY_PREFERENCES } from "../components/PreferenceForm";
import { normaliseStoredPreferences } from "../lib/preferenceProfile";
import { createOrUpdateTrip } from "../services/tripService";
import { resetPipeline, startPipeline } from "../services/generateTrip";
import { supabase } from "../lib/supabase";

const CHIPS = [
  { id: "halal",           label: "Halal-friendly",        Icon: Star },
  { id: "baby",            label: "Traveling with a baby", Icon: Baby },
  { id: "minimal_walking", label: "Minimal walking",        Icon: PersonSimpleWalk },
  { id: "step_free",       label: "Step-free access",       Icon: Wheelchair },
  { id: "vegetarian",      label: "Vegetarian-friendly",    Icon: Leaf },
  { id: "budget",          label: "Budget-friendly",        Icon: CurrencyDollar },
  { id: "late_starts",     label: "Late starts",            Icon: Moon },
  { id: "avoid_crowds",    label: "Avoid crowds",           Icon: Peace },
];

/**
 * Map chip selections onto the preference fields the itinerary generator reads
 * (supabase/functions/generate-trip builds its prompt from exactly these).
 *
 * Every chip has to land in one of them. A chip that only reaches
 * profiles.special_preferences is invisible to the prompt, so the deck is built
 * as though the traveller never ticked it.
 */
function chipsToPrefPatch(selected) {
  const dietary = [];
  const requirements = [];
  let foodBudget = "";
  let rhythm = "";
  if (selected.includes("halal")) dietary.push("Halal");
  if (selected.includes("vegetarian")) dietary.push("Vegetarian");
  if (selected.includes("budget")) foodBudget = "Value-focused";
  if (selected.includes("late_starts")) rhythm = "Relaxed mornings";
  if (selected.includes("minimal_walking")) requirements.push("Minimal walking between stops");
  if (selected.includes("step_free")) requirements.push("Step-free access needed");
  if (selected.includes("avoid_crowds")) requirements.push("Avoid crowded places");
  if (selected.includes("baby")) requirements.push("Travelling with a baby");
  return { dietary, foodBudget, rhythm, requirements };
}

export default function SetupStep3Screen({ useAppState }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, session } = useAuth();

  // joinTripId is set when a user arrives here via a join-link invite.
  // In that case the trip already exists and we just attach preferences to it
  // rather than creating a new trip or running the pipeline again.
  const joinTripId = location.state?.joinTripId ?? null;

  const {
    dest: savedDest,
    startDate: savedStart,
    endDate: savedEnd,
    tripId: appTripId,
    preferenceProfiles,
    savePreferenceProfile,
    setTripId,
    update,
  } = useAppState;

  const preferenceId = profile?.id || profile?.username || "guest";
  const [selected, setSelected] = useState([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggleChip = (id) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  };

  const buildItinerary = async () => {
    setSubmitting(true);

    const finalDest = savedDest?.trim() || "Lisbon, Portugal";
    const localStart = savedStart ? new Date(savedStart) : null;
    const localEnd = savedEnd ? new Date(savedEnd) : null;

    // Build merged preferences (existing profile prefs + chip overrides)
    const existing = normaliseStoredPreferences({ ...EMPTY_PREFERENCES, ...preferenceProfiles?.[preferenceId] });
    const { dietary, foodBudget, rhythm, requirements } = chipsToPrefPatch(selected);
    const mergedDietary = [...new Set([...(existing.dietary || []), ...dietary])];
    const mergedRequirements = [...new Set([...(existing.requirements || []), ...requirements])];
    const preferences = {
      ...existing,
      dietary: mergedDietary,
      requirements: mergedRequirements,
      foodBudget: foodBudget || existing.foodBudget,
      rhythm: rhythm || existing.rhythm,
      note: note || existing.note,
      completed: true,
      skipped: false,
    };

    // Save to local profile state
    savePreferenceProfile(preferenceId, preferences);

    // Save special_preferences + mirrored fields to Supabase if authenticated
    if (session?.user?.id) {
      try {
        await supabase.from("profiles").update({
          special_preferences: selected,
          dietary: mergedDietary,
          food_budget: foodBudget || undefined,
          rhythm: rhythm || undefined,
          preference_note: note || undefined,
          preferences_completed: true,
        }).eq("id", session.user.id);
      } catch {
        // non-blocking
      }
    }

    if (joinTripId) {
      // Joiner path: trip already exists and the leader's pipeline already
      // generated the shared deck. Just sync the tripId into app state and
      // go straight to swiping.
      if (joinTripId !== appTripId) setTripId(joinTripId);
    } else {
      // Leader / normal setup path: create the trip and fire the pipeline.
      let createdTripId = appTripId;
      try {
        const trip = await createOrUpdateTrip({
          tripId: appTripId || undefined,
          destination: finalDest,
          startDate: localStart,
          endDate: localEnd,
          leaderId: session?.user?.id,
        });
        if (trip?.id) {
          createdTripId = trip.id;
          setTripId(trip.id);
        }
      } catch {
        // non-blocking
      }

      // Reset pipeline state
      update({
        idx: 0,
        likes: 0,
        skips: 0,
        addedCards: [],
        cardsDeckId: null,
        pipelineCompleted: false,
        pipelineDest: finalDest,
        pipelineThinFallback: false,
        pipelineFailureCode: null,
        tripId: createdTripId || appTripId || null,
      });

      resetPipeline();
      // Trip length decides the deck size, so a trip without dates has no size
      // to generate. The swipe screen prompts for dates instead of guessing;
      // generating now would hand every undated trip the same list whatever
      // they were actually planning.
      if (localStart && localEnd) {
        startPipeline({
          destination: finalDest,
          startDate: localStart.toISOString(),
          endDate: localEnd.toISOString(),
          preferences,
          tripId: createdTripId || appTripId || null,
        });
      }
    }

    navigate("/swipe");
  };


  return (
    <section className="screen active screen-setup">
      {/* Progress */}
      <div style={{ padding: "4px 4px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <ProgressBar value={100} />
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 10, whiteSpace: "nowrap" }}>3 / 3</span>
        </div>
      </div>

      {/* Heading */}
      <div style={{ padding: "12px 4px 0" }}>
        <h1 style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 800, color: "var(--fg)", letterSpacing: "-0.03em" }}>
          Any special preferences?
        </h1>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--muted)" }}>Optional</p>
      </div>

      {/* Chips grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        {CHIPS.map((chip) => {
          const isSelected = selected.includes(chip.id);
          const { Icon } = chip;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => toggleChip(chip.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 14px",
                borderRadius: 16,
                border: isSelected ? "2px solid var(--fg)" : "1px solid var(--border)",
                background: isSelected ? "var(--fg)" : "var(--surface)",
                color: isSelected ? "var(--surface)" : "var(--fg)",
                fontSize: 13.5,
                fontWeight: 600,
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s ease",
              }}
            >
              <Icon size={18} weight={isSelected ? "fill" : "regular"} />
              <span>{chip.label}</span>
            </button>
          );
        })}
      </div>

      {/* Free text */}
      <div className="bento-card" style={{ padding: 16, marginTop: 10 }}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add other preferences, like quiet cafés, kid-friendly places..."
          rows={3}
          style={{
            width: "100%",
            background: "none",
            border: "none",
            outline: "none",
            resize: "none",
            fontSize: 14,
            color: "var(--fg)",
            lineHeight: 1.5,
            fontFamily: "inherit",
          }}
        />
      </div>

      {/* Build CTA */}
      <button
        className="btn btn-primary btn-block"
        style={{
          marginTop: 24,
          background: "var(--fg)",
          color: "var(--surface)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
        onClick={buildItinerary}
        disabled={submitting}
      >
        <Sparkle size={18} weight="fill" />
        <span>{submitting ? "Building your itinerary…" : "Build my itinerary"}</span>
      </button>
    </section>
  );
}
