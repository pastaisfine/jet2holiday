import { useState, useReducer, useRef, useCallback, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import SwipeCard from "../components/SwipeCard";
import BottomSheet from "../components/BottomSheet";
import ReasonChips from "../components/ReasonChips";
import InfiniteSpiral from "../components/InfiniteSpiral";
import { searchPlaces } from "../services/placesAutocomplete";
import { useAuth } from "../context/useAuth";
import { usePipeline, startPipeline } from "../services/generateTrip";
import { supabase } from "../lib/supabase";
import { CARD_DATA } from "../data/cards";
import { normaliseStoredPreferences } from "../lib/preferenceProfile";
import { addSwipedKey, buildSwipedKeys, partitionDeck } from "../lib/swipeDeck";
import { describeDeckFailure, isThinDestination, CLIENT_FAILURE } from "../lib/deckFailure";
import {
  analyzePreferences,
  savePreferenceSummary,
  getPreferenceSummary,
  readPreferenceHandoff,
  writePreferenceHandoff,
  clearPreferenceHandoff,
  summaryCoversSwipes,
} from "../services/preference";
import { preloadImage } from "../services/imagePreloader";
import {
  getTrip,
  getTripDeckId,
  getTripMembers,
  getUserSwipes,
  subscribeTripMembers,
} from "../services/tripService";
import InviteCrewDialog from "../components/InviteCrewDialog";
import { buildInviteLink } from "../lib/inviteLink";
import { shouldPromptForInvite, shouldRetireInvitePrompt } from "../lib/invitePrompt";

const LISBON_FALLBACK = "Lisbon, Portugal";

const initialSheets = { reason: false, detail: false, addPlace: false, more: false };
const preferenceOptions = {
  rhythm: ["Early start", "Balanced", "Relaxed mornings", "Flexible"],
  density: ["Packed", "Balanced", "Unstructured", "Flexible"],
  dining: ["Street food", "Cafes", "Quick service", "Fine dining", "Flexible"],
  foodBudget: ["Value-focused", "Balanced", "Food is a highlight", "Flexible"],
  dietary: ["None", "Vegetarian", "Vegan", "Halal", "Kosher", "Gluten-free", "Dairy-free", "Nut allergy", "Other"],
};
const emptyPreferences = { rhythm: "", density: "", dietary: [], dining: "", foodBudget: "", note: "" };

function sheetsReducer(state, action) {
  switch (action.type) {
    case "reason":
      return { ...initialSheets, reason: true };
    case "detail":
      return { ...initialSheets, detail: true };
    case "addPlace":
      return { ...initialSheets, addPlace: true };
    case "more":
      return { ...initialSheets, more: true };
    case "close":
      return initialSheets;
    default:
      return state;
  }
}

const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);
const HeartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
  </svg>
);

export default function SwipeScreen({ useAppState }) {
  const navigate = useNavigate();
  const { profile, session } = useAuth();
  const {
    likes,
    skips,
    swipeCard,
    saveReason,
    allCards,
    appendCard,
    appendGeneratedCards,
    markPipelineCompleted,
    preferenceProfiles,
    savePreferenceProfile,
    dest,
    startDate,
    endDate,
    pipelineCompleted,
    tripId,
    update,
    addedCards,
    tagged,
    pipelineThinFallback,
    pipelineFailureCode,
    invitePromptDismissed,
  } = useAppState;
  const pipeline = usePipeline();
  const preferenceId = profile?.id || profile?.username || "guest";
  const ingestedRef = useRef(0);
  // The scope every summary store agrees on: the trip when there is one, the
  // destination otherwise. readPreferenceHandoff builds its key from this.
  const handoffScope = useMemo(
    () => ({
      userId: session?.user?.id,
      tripId,
      destination: dest || LISBON_FALLBACK,
    }),
    [session?.user?.id, tripId, dest]
  );
  const currentSwipeIdRef = useRef(null);
  // The scope the analysis has been started for, if any. Holding the scope
  // rather than a boolean means a scope change -- switching accounts, or a
  // different destination -- re-arms the trigger without an effect that would
  // reset on StrictMode's double invoke.
  const preferenceAnalysisScopeRef = useRef(null);
  const lastSwipePersistRef = useRef(Promise.resolve());

  // Cards this member has already judged, rebuilt from the database. Until the
  // read resolves the deck renders whole, so a slow query costs a moment of
  // over-showing rather than blocking the screen.
  const [swipedKeys, setSwipedKeys] = useState(() => ({ ids: new Set(), names: new Set() }));
  const taggedRef = useRef(tagged);
  useEffect(() => {
    taggedRef.current = tagged;
  }, [tagged]);

  const hydratedScopeRef = useRef(null);
  useEffect(() => {
    if (!session?.user?.id) return undefined;

    const scope = `${session.user.id}::${tripId || ""}::${dest || LISBON_FALLBACK}`;
    if (hydratedScopeRef.current === scope) return undefined;
    hydratedScopeRef.current = scope;

    let cancelled = false;

    (async () => {
      try {
        const rows = await getUserSwipes({ tripId, destination: dest || LISBON_FALLBACK });
        if (cancelled) return;

        setSwipedKeys(buildSwipedKeys(rows));

        // Local reasons win over the stored row so a just-saved reason is not
        // briefly reverted by a slower read; the DB fills in everything from
        // earlier sessions that this device never had.
        const taggedFromDb = {};
        for (const row of rows) {
          if (row.card_id == null) continue;
          taggedFromDb[String(row.card_id)] = {
            dir: row.direction === "like" ? "yes" : "no",
            reasons: Array.isArray(row.reasons) ? row.reasons : [],
          };
        }

        update({
          likes: rows.filter((row) => row.direction === "like").length,
          skips: rows.filter((row) => row.direction === "skip").length,
          idx: rows.length,
          tagged: { ...taggedFromDb, ...taggedRef.current },
        });
      } catch (error) {
        // Progress falls back to whatever localStorage held; the screen stays
        // usable rather than blocking on a failed read.
        console.warn("Could not load swipe progress:", error?.message || error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, tripId, dest, update]);

  const [preferenceOpen, setPreferenceOpen] = useState(() => sessionStorage.getItem("edit-preferences") === "true");
  // The status is tagged with the scope it was produced for, so a late result
  // from a previous scope can be ignored when rendering rather than guarded
  // with a ref (which must not be read during render).
  const [preferenceAnalysis, setPreferenceAnalysis] =
  useState({ scope: null, status: "idle" });
  const preferenceAnalysisStatus =
    preferenceAnalysis.scope === handoffScope ? preferenceAnalysis.status : "idle";

  // The session hand-off, read once per scope. A cached summary is good enough
  // to enable the button before the freshness check has run: the screen the
  // user reaches is identical either way, and a stale cache flips to
  // "Analysing…" once runPreferenceAnalysis finds it out.
  const handoff = useMemo(
    () => readPreferenceHandoff(handoffScope),
    [handoffScope]
  );
  const summaryStatus =
    preferenceAnalysisStatus === "idle" && handoff
      ? "success"
      : preferenceAnalysisStatus;

  const [preferences, setPreferences] = useState(() => normaliseStoredPreferences({ ...emptyPreferences, ...preferenceProfiles?.[preferenceId], dietary: preferenceProfiles?.[preferenceId]?.dietary || [] }));

  const runPreferenceAnalysis = useCallback(async ({ force = false } = {}) => {
  const scope = handoffScope;
  const cached = readPreferenceHandoff(scope);
  // Tagging every status with this call's scope means the render only shows it
  // while the scope still matches. The ref check stops a late result from a
  // previous scope replacing the current scope's status outright; the tag stops
  // it rendering even if it lands between the ref moving on and then.
  const setStatus = (status) => {
    if (preferenceAnalysisScopeRef.current !== scope) return;
    setPreferenceAnalysis({ scope, status });
  };

  // A hand-off already on screen reads as success, so only show "Analysing…"
  // when there is nothing to show (or a retry is deliberately replacing it).
  // A stale hand-off falls through and shows loading just before the call.
  if (force || !cached) {
    setStatus("loading");
  }

  try {
    await lastSwipePersistRef.current;

    const destination = dest || LISBON_FALLBACK;

    // Scoped to the trip, not just the destination. A destination is only a
    // city name, so filtering on it alone would average together every trip the
    // user has ever taken to that city -- two Kuala Lumpur trips with different
    // people would produce one summary spanning both, which is then saved
    // against this trip alone. Falls back to the destination when the user is
    // not in a trip yet, which is when the swipes carry a null trip_id too.
    let query = supabase
      .from("swipes")
      .select("card_name, direction, reasons, category")
      .eq("user_id", session.user.id);

    query = tripId
      ? query.eq("trip_id", tripId)
      : query.eq("destination", destination);

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const swipes = (data || []).map((swipe) => ({
      card_name: swipe.card_name,
      direction: swipe.direction,
      reasons: Array.isArray(swipe.reasons)
        ? swipe.reasons
        : [],
      category: swipe.category || null,
    }));

    // Reuse only a summary that covers exactly these swipes. The hand-off is
    // checked first because it is already in memory; a stale one falls through
    // to the durable row, and a stale durable row re-runs the agent. Retry
    // passes force, which skips both stores so the button always re-bills.
    if (!force) {
      if (summaryCoversSwipes(cached, swipes.length)) {
        setStatus("success");
        return;
      }

      try {
        const stored = await getPreferenceSummary({ tripId, destination });
        if (summaryCoversSwipes(stored, swipes.length)) {
          setStatus("success");
          return;
        }
      } catch (lookupError) {
        console.warn(
          "[Preference Agent] Could not check the stored summary:",
          lookupError
        );
      }
    }

    setStatus("loading");

    const result = await analyzePreferences({
      profile: {
        username: profile?.username || "",
        rhythm: profile?.rhythm || "",
        density: profile?.density || "",
        dining: profile?.dining || "",
        foodBudget: profile?.foodBudget || "",
        dietary: profile?.dietary || [],
        preferenceNote: profile?.preferenceNote || "",
        travelStyle: profile?.travelStyle || "",
      },
      initialPreferences: preferences,
      destination,
      swipes,
    });

    if (import.meta.env.DEV) {
      console.log(
        "[Preference Agent] Personal preference summary:",
        result.summary
      );
    }

    // metadata carries the counts the summary cannot state about itself -- how
    // many swipes it was derived from, and the exact category tally behind any
    // claim in it. The style screen reads both halves and tolerates a bare
    // summary; the helpers own the key and the shape (see services/preference).
    writePreferenceHandoff({
      ...scope,
      summary: result.summary,
      metadata: result.metadata,
    });

    // sessionStorage above is only a hand-off to the style screen, which reads
    // it on mount; this is the copy that survives the tab. A failed write must
    // not strand the user on a spinner -- the analysis itself succeeded, and the
    // next run overwrites whatever is missing.
    try {
      await savePreferenceSummary({
        summary: result.summary,
        metadata: result.metadata,
        tripId,
        destination,
        expectedUserId: scope.userId,
      });
    } catch (saveError) {
      console.error(
        "[Preference Agent] Failed to persist summary:",
        saveError
      );
    }

    setStatus("success");
  } catch (error) {
    console.error(
      "[Preference Agent] Analysis failed:",
      error
    );

    // Only re-arm if the scope has not moved on: a late failure from the
    // previous scope must not clear the new scope's guard. Its status is
    // scope-tagged, so a stale error is ignored on render either way.
    if (preferenceAnalysisScopeRef.current === scope) {
      preferenceAnalysisScopeRef.current = null;
    }
    setStatus("error");
  }
}, [
  session,
  profile,
  preferences,
  dest,
  tripId,
  handoffScope,
]);


  useEffect(() => {
    const saved = preferenceProfiles?.[preferenceId];
    if (saved) setPreferences(normaliseStoredPreferences({ ...emptyPreferences, ...saved, dietary: saved.dietary || [] }));
    if (sessionStorage.getItem("edit-preferences") === "true") {
      sessionStorage.removeItem("edit-preferences");
      setPreferenceOpen(true);
    }
  }, [preferenceId, preferenceProfiles]);
  const [sheets, dispatchSheets] = useReducer(sheetsReducer, initialSheets);
  const [reasonCard, setReasonCard] = useState(null);
  const [reasonDir, setReasonDir] = useState("yes");
  const [reasonSel, setReasonSel] = useState([]);
  const [reasonFree, setReasonFree] = useState("");
  const [detailCard, setDetailCard] = useState(null);

  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState([]);
  const [placeSelected, setPlaceSelected] = useState(null);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const debounceRef = useRef(null);
  const searchSeqRef = useRef(0);

  const [readyCardIds, setReadyCardIds] = useState(() => new Set(CARD_DATA.map((c) => c.id)));

  // Hard lock: once the leader starts the group build, the preference snapshot
  // is frozen. The database trigger enforces it; this state keeps the deck
  // from pretending otherwise. Keyed by trip so switching trips cannot show a
  // stale lock, and a failed fetch fails open rather than closed.
  //
  // The value is tri-state: absent means the read has not resolved yet, null
  // means resolved and unlocked, a timestamp means locked. The analysis effect
  // waits on the resolved half (lockKnown) so it can never arm an agent run on
  // a trip that locked while the screen was still mounting.
  const [lockByTrip, setLockByTrip] = useState({});
  useEffect(() => {
    if (!tripId) return undefined;
    let active = true;
    supabase
      .from("trips")
      .select("preferences_locked_at")
      .eq("id", tripId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) {
          setLockByTrip((prev) => ({ ...prev, [tripId]: data?.preferences_locked_at || null }));
        }
      })
      .catch(() => {
        // Fail open: no row read is no evidence of a lock.
        if (active) {
          setLockByTrip((prev) => ({ ...prev, [tripId]: prev[tripId] ?? null }));
        }
      });
    return () => { active = false; };
  }, [tripId]);
  const locked = Boolean(tripId) && Boolean(lockByTrip[tripId]);
  const lockKnown = !tripId || tripId in lockByTrip;

  // Durable-row half of the locked card's existence check: the hand-off
  // covers the instant case above, and this is the copy that survives the
  // tab. Read-only, never an agent run -- the deck-cleared effect stays away
  // from locked trips, so nothing else produces a summary here. The verdict is
  // tagged with the scope it was fetched for, so a scope change cannot show
  // the previous scope's answer while the new read is in flight.
  const [durableSummary, setDurableSummary] = useState({ scope: null, exists: null });
  useEffect(() => {
    if (!locked || !session?.user?.id || handoff) return undefined;
    let cancelled = false;
    getPreferenceSummary({ tripId, destination: dest || LISBON_FALLBACK })
      .then((row) => { if (!cancelled) setDurableSummary({ scope: handoffScope, exists: Boolean(row) }); })
      .catch(() => { if (!cancelled) setDurableSummary({ scope: handoffScope, exists: false }); });
    return () => { cancelled = true; };
  }, [locked, session?.user?.id, handoff, handoffScope, tripId, dest]);
  const summaryExists = handoff
    ? true
    : durableSummary.scope === handoffScope
      ? durableSummary.exists
      : null;

  const addedCardsRef = useRef(addedCards);
  useEffect(() => {
    addedCardsRef.current = addedCards;
  }, [addedCards]);

  const hardcodedIds = useMemo(() => new Set(CARD_DATA.map((c) => c.id)), []);
  const generatedCards = useMemo(
    () => (addedCards || []).filter((c) => !hardcodedIds.has(c.id)),
    [addedCards, hardcodedIds],
  );

  const isLisbon = !dest || dest === LISBON_FALLBACK;
  // The fallback cards are the Lisbon deck. A trip to anywhere else must never
  // be shown them: verdicts are stored under the trip's own destination, so
  // Lisbon cards would otherwise feed the preference agent Lisbon data for a
  // Barcelona trip. Trips without dates have no sized deck to size a generation
  // for, but their linked deck (if one exists) still resumes below.
  const showFallbackDeck = isLisbon || Boolean(pipelineThinFallback);
  // A trip without dates has no deck to size and nothing to resume, so the
  // header CTA points the traveller at adding them.
  const hasTripDates = Boolean(startDate && endDate);

  // Generated cards are no longer gated on their image bytes having arrived. A
  // card renders as soon as its row lands and falls back to a placeholder if
  // the photo never loads, because a deck that silently drops spots is worse
  // than a deck with a gap in it. The hardcoded deck keeps the original gate:
  // its images are local and always available.
  const visibleCards = useMemo(() => {
    if (showFallbackDeck) {
      return allCards.filter((c) => readyCardIds.has(c.id));
    }
    return generatedCards;
  }, [showFallbackDeck, allCards, readyCardIds, generatedCards]);

  // Progress is the difference between the deck and the judged set, never a
  // positional counter: a refresh, an invite link, or a new device all rebuild
  // from the same durable swipe rows.
  const { unswiped, swipedCount } = useMemo(
    () => partitionDeck(visibleCards, swipedKeys),
    [visibleCards, swipedKeys],
  );
  const total = visibleCards.length;
  const spiralItems = useMemo(
    () => visibleCards.map((card) => ({ id: card.id, src: card.img, alt: card.name })),
    [visibleCards],
  );

  // Resume an existing deck when this session never started one.
  //
  // The deck lives in the database, so it outlives the session that generated
  // it. Without this, arriving at /swipe directly (new device, cleared
  // localStorage, or a shared link) would show nothing, and a member who
  // joined mid-generation would never receive the cards still landing. On a
  // cache hit this costs one query and no edge function call.
  const resumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    if (!tripId || !session?.user?.id) return;
    // SetupScreen already started a pipeline for this screen; nothing to resume.
    if (pipeline.phase !== "idle") return;
    // Local cards mean we have a deck to show already.
    if (addedCards && addedCards.length > 0) return;

    resumeAttemptedRef.current = true;

    (async () => {
      const linkedDeckId = await getTripDeckId(tripId);
      if (!linkedDeckId) return;
      // Record the deck the cards will actually come from: startPipeline may
      // claim a different deck (destination, preferences and trip length all
      // shape the key), and cardsDeckId is what another trip's link compares
      // against to tell the decks apart when switching trips.
      const deckId = (await startPipeline({
        destination: dest || LISBON_FALLBACK,
        startDate,
        endDate,
        preferences: preferences || {},
        tripId,
      })) || linkedDeckId;

      update({ cardsDeckId: deckId });
    })();
  }, [tripId, session?.user?.id, pipeline.phase, dest, preferences, addedCards, update, startDate, endDate]);

  // Ask a lone leader to invite their crew.
  //
  // This cannot live on the setup screens: the trip row is only written at the
  // end of step 3, so before this point there is no link to share. The deck is
  // the first screen guaranteed to run after the trip exists, so it is where
  // the question becomes answerable. It is deliberately not gated on the deck
  // being ready -- the link is valid the moment the trip row lands, and waiting
  // only delays the one moment the leader can actually act on.
  const [inviteOpen, setInviteOpen] = useState(false);
  const dismissInvite = useCallback(() => {
    setInviteOpen(false);
    update({ invitePromptDismissed: true });
  }, [update]);

  useEffect(() => {
    if (!tripId || !session?.user?.id) return undefined;
    let cancelled = false;

    (async () => {
      const [trip, members] = await Promise.all([
        getTrip(tripId),
        getTripMembers(tripId).catch(() => []),
      ]);
      if (cancelled) return;

      const prompt = shouldPromptForInvite({
        tripId,
        userId: session.user.id,
        leaderId: trip?.leader_id,
        members,
        dismissed: invitePromptDismissed,
      });
      if (prompt) setInviteOpen(true);
    })();

    return () => { cancelled = true; };
  }, [tripId, session?.user?.id, invitePromptDismissed]);

  // A member joining retires the prompt without waiting for the leader to come
  // back and reload -- by then they have a crew, so there is nothing left to
  // ask. Recorded as a dismissal so it cannot reappear on the next visit.
  useEffect(() => {
    if (!tripId || !session?.user?.id) return undefined;

    return subscribeTripMembers(tripId, async () => {
      const members = await getTripMembers(tripId).catch(() => []);
      if (shouldRetireInvitePrompt(members)) dismissInvite();
    });
  }, [tripId, session?.user?.id, dismissInvite]);

  // Ingest streamed deck rows into the card deck. Cards arrive already in UI
  // shape, so this is an append rather than a mapping step, and the deck grows
  // while the rest of the deck is still being generated.
  useEffect(() => {
    if (pipeline.cards.length <= ingestedRef.current) return;
    const fresh = pipeline.cards.slice(ingestedRef.current);
    ingestedRef.current = pipeline.cards.length;

    appendGeneratedCards(fresh);
    if (!pipelineCompleted) markPipelineCompleted(dest || LISBON_FALLBACK);
  }, [pipeline.cards, appendGeneratedCards, markPipelineCompleted, dest, pipelineCompleted]);

  // Warm the image cache in the background. Failure is expected and harmless
  // here: the card is already in the deck, and SwipeCard's onError hides the
  // broken <img> so the card's gradient placeholder shows through.
  useEffect(() => {
    const pending = generatedCards.filter((c) => c.img && !readyCardIds.has(c.id));
    if (pending.length === 0) return;

    let active = true;

    pending.forEach((card) => {
      preloadImage(card.img)
        .then(() => {
          if (active) setReadyCardIds((prev) => new Set(prev).add(card.id));
        })
        .catch((err) => {
          console.warn(`[Image Preload] "${card.name}" has no usable photo, showing placeholder:`, err?.message || err);
        });
    });

    return () => {
      active = false;
    };
  }, [generatedCards, readyCardIds]);

  // Q22: the pipeline settled with nothing to show -> say what is actually known.
  //
  // The cause is never inferred from the card count. An empty deck means one of
  // several very different things -- a thin destination, a storage fault, a
  // request that never arrived, or a client reading a key the generator never
  // wrote -- and only the server knows which. When it named one, it arrives as
  // `errorCode` and is rendered as given; when it named none, this is an
  // unknown and is reported as one. The previous version called every empty
  // deck "limited photo-verified places found for {destination}", which
  // blamed Johor for a backend bug that had generated twelve cards correctly.
  useEffect(() => {
    if (!dest || dest === LISBON_FALLBACK || pipelineThinFallback) return;
    const settled = pipeline.phase === "done" || pipeline.phase === "error";
    if (settled && generatedCards.length < 2) {
      update({
        pipelineThinFallback: true,
        // A code the server already gave us outranks whatever we infer. Only a
        // pipeline that reported success but delivered nothing leaves this
        // unexplained, which is precisely the stale-deploy signature.
        pipelineFailureCode: pipeline.errorCode || CLIENT_FAILURE.UNEXPLAINED_EMPTY,
      });
    }
  }, [dest, pipelineThinFallback, pipeline.phase, pipeline.errorCode, generatedCards.length, update]);

  // Cards landing clears the banner, and with it any failure we were reporting.
  useEffect(() => {
    if (pipelineThinFallback && generatedCards.length >= 2) {
      update({ pipelineThinFallback: false, pipelineFailureCode: null });
    }
  }, [pipelineThinFallback, generatedCards.length, update]);

  const handleVerdict = (dir) => {
  const card = unswiped[0];
  if (!card || locked) return;

  const swipeId = crypto.randomUUID();
  currentSwipeIdRef.current = swipeId;

  swipeCard(dir);

  // The card disappears the moment the verdict is cast, from the same key set
  // the durable rows produced, so the optimistic update and the next refresh
  // agree about what is left.
  setSwipedKeys((prev) => addSwipedKey(prev, card));

  const tracked = persistSwipe(card, dir, null, swipeId).then((id) => {
    // The stored row may pre-date this session; keep the reason save pointed
    // at the row that actually exists.
    if (id) currentSwipeIdRef.current = id;
    return id;
  });
  lastSwipePersistRef.current = tracked;

  setReasonCard(card);
  setReasonDir(dir);
  setReasonSel([]);
  setReasonFree("");
  dispatchSheets({ type: "reason" });
};

  // One verdict per (member, trip/destination, place), never a second row.
  //
  // PostgREST's on_conflict cannot name the partial unique indexes that enforce
  // this, so the existing row is looked up first and updated in place -- the
  // same pattern savePreferenceSummary uses. Never rejects: a swipe is a
  // fire-and-forget write, and a failure is logged rather than allowed to
  // interrupt the deck.
  const persistSwipe = useCallback(
  async (card, dir, reasons = null, knownId = null) => {
    if (!session?.user?.id || !card) {
      return null;
    }

    const finalReasons =
      reasons && reasons.length > 0 ? reasons : null;

    const row = {
      user_id: session.user.id,
      card_id: String(card.id),
      card_name: card.name,
      // Lets the Preference Agent see that a skipped place was a food venue
      // rather than inferring it from the name. Null for user-added places,
      // which have no category anywhere in the system.
      category: card.category || null,
      destination: dest || LISBON_FALLBACK,
      direction: dir === "yes" ? "like" : "skip",
      reasons: finalReasons,
      reason: finalReasons ? finalReasons.join(", ") : null,
      trip_id: tripId || null,
    };

    const findExisting = () => {
      let query = supabase
        .from("swipes")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("card_id", String(card.id));

      query = tripId
        ? query.eq("trip_id", tripId)
        : query.is("trip_id", null).eq("destination", row.destination);

      return query.limit(1).maybeSingle();
    };

    try {
      const { data: existing, error: lookupError } = await findExisting();
      if (lookupError) throw lookupError;

      if (existing) {
        const { error } = await supabase
          .from("swipes")
          .update(row)
          .eq("id", existing.id);

        if (error) throw error;
        return existing.id;
      }

      const id = knownId || crypto.randomUUID();
      const { error } = await supabase.from("swipes").insert({ ...row, id });

      if (error) {
        // A concurrent tab inserted the same verdict between the lookup and
        // this insert. Adopt its row rather than failing the swipe.
        if (error.code === "23505") {
          const { data: conflict } = await findExisting();
          if (conflict?.id) {
            await supabase.from("swipes").update(row).eq("id", conflict.id);
            return conflict.id;
          }
        }
        throw error;
      }

      return id;
    } catch (error) {
      console.warn("Swipe persistence failed:", error?.message || error);
      return knownId || null;
    }
  },
  [session, dest, tripId]
);

  const saveAndClose = async () => {
    if (!reasonCard) {
      dispatchSheets({ type: "close" });
      return;
    }
    const reasons = [...reasonSel];
    if (reasonFree.trim()) reasons.push(reasonFree.trim());
    const finalReasons = reasons.length > 0 ? reasons : null;

    saveReason(reasonCard.id, reasonDir, reasons);

    // Wait for the verdict's own write so the reasons land on the same row
    // instead of racing it.
    const persistedId = await lastSwipePersistRef.current;
    await persistSwipe(
      reasonCard,
      reasonDir,
      finalReasons,
      persistedId || currentSwipeIdRef.current
    );

    dispatchSheets({ type: "close" });
  };

useEffect(() => {
  if (total === 0) return;
  if (unswiped.length > 0) return;
  if (sheets.reason) return;
  if (pipeline.phase === "generating") return;
  if (!session?.user?.id) return;
  // The lock read settles before any agent run is armed: a locked trip never
  // re-bills the analysis (the swipes are frozen, so the summary stays exactly
  // as it was at lock time), and an unlocked trip is not held hostage to a
  // read that has not landed yet.
  if (!lockKnown) return;
  if (locked) return;
  // One run per scope: a subsequent render, or StrictMode's double invoke,
  // sees the scope already recorded and does nothing.
  if (preferenceAnalysisScopeRef.current === handoffScope) return;

  preferenceAnalysisScopeRef.current = handoffScope;
  runPreferenceAnalysis();
}, [
  unswiped.length,
  total,
  sheets.reason,
  pipeline.phase,
  session,
  lockKnown,
  locked,
  handoffScope,
  runPreferenceAnalysis,
]);

  const openDetail = (card) => {
    setDetailCard(card || unswiped[0] || null);
    dispatchSheets({ type: "detail" });
  };

  const handlePlaceSearch = useCallback((value) => {
    const searchSeq = ++searchSeqRef.current;
    setPlaceQuery(value);
    setPlaceSelected(null);
    setPlaceError("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setPlaceResults([]);
      setPlaceLoading(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setPlaceLoading(true);
      try {
        const results = await searchPlaces(value);
        if (searchSeq === searchSeqRef.current) setPlaceResults(results);
      } catch (err) {
        if (searchSeq === searchSeqRef.current && err.name !== "AbortError") {
          setPlaceError(err.message || "Search failed");
          setPlaceResults([]);
        }
      } finally {
        if (searchSeq === searchSeqRef.current) setPlaceLoading(false);
      }
    }, 350);
  }, []);

  const handlePlaceConfirm = () => {
    if (!placeSelected) return;
    const card = {
      id: `user-${placeSelected.placeId}`,
      name: placeSelected.mainText,
      area: placeSelected.secondaryText || "Custom location",
      cat: ["Custom"],
      // Left null deliberately. The autocomplete proxy returns a bare slug with
      // no category (see supabase/functions/places-autocomplete), so anything
      // set here would be a guess. The swipe records the gap honestly and the
      // agent simply has no category signal for this card.
      category: null,
      cost: "—",
      img: placeSelected.mapImageUrl || "/images/alfama.jpg",
      blurb: placeSelected.description,
      likeR: ["User-added location"],
      noR: [],
      detail: [placeSelected.description],
    };
    appendCard(card);
    setPlaceQuery("");
    setPlaceResults([]);
    setPlaceSelected(null);
    dispatchSheets({ type: "close" });
  };

  const savePreferences = () => {
    savePreferenceProfile(preferenceId, { ...preferences, completed: true });
    setPreferenceOpen(false);
  };

  const skipPreferences = () => {
    savePreferenceProfile(preferenceId, { ...preferences, completed: false, skipped: true });
    setPreferenceOpen(false);
  };

  const toggleDietary = (option) => {
    setPreferences((current) => {
      if (option === "None") return { ...current, dietary: current.dietary.includes("None") ? [] : ["None"] };
      const dietary = current.dietary || [];
      return { ...current, dietary: [...dietary.filter((item) => item !== "None"), ...(dietary.includes(option) ? [] : [option])] };
    });
  };

return (
      <section className="screen active spiral-screen spiral-screen--swipe" style={{ overflow: "hidden" }}>
        <div className="spiral-backdrop" aria-hidden="true">
          <InfiniteSpiral
            items={spiralItems}
            speed={0.12}
            direction="down"
            radius={250}
            cardWidth={178}
            cardHeight={238}
            verticalSpacing={126}
            cardsPerTurn={7}
            rotation={-22}
            cardTilt={5}
            cardRadius={24}
            centerScale={1.03}
            edgeFade={0.2}
            edgeBlur={10}
            grayscale={0.48}
            pauseOnHover={false}
          />
        </div>
        <div className="swipe-head">
          <div>
            <div className="eyebrow" style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 11 }}>Swipe deck</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, marginTop: 2, color: "var(--fg)" }}>
              {unswiped.length === 0 ? total : Math.min(swipedCount + 1, total)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>of {total} places</span>
            </div>
            {!hasTripDates && (
              <button
                onClick={() => navigate("/setup/step1")}
                style={{ background: "none", border: "none", padding: 0, marginTop: 4, color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left" }}
              >
                Add your dates for a deck sized to your trip →
              </button>
            )}
          </div>
          <div className="chip" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--fg)", fontWeight: 600, fontSize: 12, padding: "4px 12px" }}>
            {likes} liked · {skips} skipped
          </div>
        </div>

        {pipelineThinFallback && dest && dest !== LISBON_FALLBACK && (
          <div
            style={{
              margin: "0 20px 10px",
              padding: "8px 12px",
              background: "var(--surface)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              fontSize: 12,
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ color: isThinDestination(pipelineFailureCode) ? "var(--accent)" : "var(--nom)" }}>
              ●
            </span>
            <span>{describeDeckFailure(pipelineFailureCode, dest)}</span>
          </div>
        )}

        {locked ? (
          <div className="deck-zone">
            <div className="deck sw-empty card">
              <div className="eyebrow">Preferences locked</div>
              <h2 className="h-display" style={{ fontSize: 23 }}>
                The group plan is under way.
              </h2>
              <p className="splash-copy" style={{ textAlign: "center" }}>
                The trip creator started the shared build, so swiping is closed for this trip.
                Your preferences stay exactly as you left them.
              </p>
              <button className="btn btn-primary" onClick={() => navigate("/plan")}>
                View the group plan
              </button>
              {summaryExists === true && (
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: 8 }}
                  onClick={() => navigate("/style", { state: { from: "swipe" } })}
                >
                  See my summary
                </button>
              )}
            </div>
          </div>
        ) : unswiped.length === 0 && !sheets.reason ? (
          <div className="deck-zone">
            {pipeline.phase === "generating" ? (
              <div className="deck">
                <div className="swcard loading-skeleton-card" style={{ zIndex: 30 }}>
                  <div className="ph skeleton-ph" style={{ position: "absolute", inset: 0, zIndex: 0 }}>
                    <div className="skeleton-shimmer" />
                    <div className="topline">
                      <span className="chip">Curating…</span>
                      <span className="chip">★ …</span>
                    </div>
                    <div className="skeleton-center">
                      <div className="skeleton-spinner" />
                      <div className="skeleton-status-title">
                        {pipeline.expectedCount > 0
                          ? `Checking photos… ${pipeline.cards.length} of ${pipeline.expectedCount} ready`
                          : "Curating spots with photos…"}
                      </div>
                      <div className="skeleton-status-sub">
                        {dest ? `Finding places in ${dest}` : "Checking photo availability"}
                      </div>
                    </div>
                    <div className="veil" />
                  </div>
                  <div className="body" style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 1, background: "transparent", padding: "20px" }}>
                    <div className="skeleton-line title" />
                    <div className="skeleton-line sub" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="deck sw-empty card">
                <div className="eyebrow">Deck cleared</div>
                <h2 className="h-display" style={{ fontSize: 23 }}>
                  That's a full opinion.
                </h2>
                <p className="splash-copy" style={{ textAlign: "center" }}>
                  {likes} likes, {skips} skips and every reason is now a weighted signal — not just a tick box.
                </p>

                 <button
                    className="btn btn-primary"
                    disabled={summaryStatus !== "success"}
                    onClick={() => navigate("/style")}
                  >
                    {summaryStatus === "loading"
                      ? "Analysing your choices…"
                      : summaryStatus === "success"
                        ? "See my summary"
                        : "Preparing your summary…"}
                  </button>

                {(summaryStatus === "success" ||
                  summaryStatus === "error") && (
                  <button
                    className="btn btn-secondary"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      // Retry always re-runs the agent: clearing the hand-off
                      // and forcing past the reuse checks is what makes the
                      // button mean "regenerate", not "show me the cache".
                      clearPreferenceHandoff(handoffScope);
                      preferenceAnalysisScopeRef.current = handoffScope;

                      runPreferenceAnalysis({ force: true });
                    }}
                  >
                    Retry analysis
                  </button>
                )}
                  <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => dispatchSheets({ type: "addPlace" })}>
                    More itineraries on your mind?
                  </button>
                </div>
              )}
            </div>
        ) : (
          <div className="deck-zone">
          <div className="deck">
            {unswiped.slice(0, 3).map((card, i) => {
              const stacked = i;
              return (
                <SwipeCard
                  key={card.id}
                  card={card}
                  stacked={stacked}
                  onVerdict={handleVerdict}
                  onDetail={() => openDetail(card)}
                />
              );
            })}
            </div>
          </div>
        )}

        {unswiped.length > 0 && (
          <div className="sw-actions">
            <button className="sw-btn no" onClick={() => handleVerdict("no")} aria-label="Skip">
              <XIcon />
            </button>
            <button className="sw-btn" onClick={() => openDetail()} aria-label="Details" style={{ width: 52, height: 52 }}>
              <InfoIcon />
            </button>
            <button className="sw-btn yes" onClick={() => handleVerdict("yes")} aria-label="Like">
              <HeartIcon />
            </button>
         </div>
        )}

        <BottomSheet open={preferenceOpen} onClose={() => setPreferenceOpen(false)} className="preference-sheet">
          <div className="eyebrow">Before you swipe</div>
          <h3>Your trip rhythm</h3>
          <p className="sub">A few light preferences help us shape your recommendations later. You can skip this for now.</p>
          {[["rhythm", "Daily rhythm"], ["density", "Itinerary density"], ["dining", "Dining style"], ["foodBudget", "Food budgeting"]].map(([key, label]) => (
            <div className="preference-group" key={key}>
              <label>{label}</label>
              <div className="preference-options">{preferenceOptions[key].map((option) => <button type="button" key={option} className={`preference-option ${preferences[key] === option ? "sel" : ""}`} onClick={() => setPreferences((current) => ({ ...current, [key]: option }))}>{option}</button>)}</div>
            </div>
          ))}
          <div className="preference-group"><label>Dietary restrictions</label><div className="preference-options">{preferenceOptions.dietary.map((option) => <button type="button" key={option} className={`preference-option ${(preferences.dietary || []).includes(option) ? "sel" : ""}`} onClick={() => toggleDietary(option)}>{option}</button>)}</div></div>
          <input className="input" value={preferences.note} onChange={(event) => setPreferences((current) => ({ ...current, note: event.target.value }))} placeholder="Allergies or requirements (optional)" />
          <div className="actions"><button className="btn btn-secondary" onClick={skipPreferences}>Skip for now</button><button className="btn btn-primary" onClick={savePreferences}>Save preferences</button></div>
        </BottomSheet>

        <BottomSheet
          open={sheets.reason}
          onClose={() => dispatchSheets({ type: "close" })}
        >
          <h3>{reasonDir === "yes" ? "Why the yes?" : "What ruled it out?"}</h3>
          <p className="sub">
            {reasonDir === "yes"
              ? `These adjust how we rank ${reasonCard?.name} for you — and for the group.`
              : 'Hard "no"s stick. They\'re dealbreakers, not points against.'}
          </p>
          <ReasonChips
            chips={reasonDir === "yes" ? reasonCard?.likeR || [] : reasonCard?.noR || []}
            selected={reasonSel}
            onToggle={(r) =>
              setReasonSel((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
            }
          />
          <input
            className="reason-input"
            placeholder="Add a note (optional)"
            value={reasonFree}
            onChange={(e) => setReasonFree(e.target.value)}
          />
          <div className="actions">
            <button className="btn btn-secondary" onClick={() => dispatchSheets({ type: "close" })}>
              Skip
            </button>
            <button className="btn btn-primary" onClick={saveAndClose}>
              Save reason
            </button>
          </div>
        </BottomSheet>

        <BottomSheet
          open={sheets.detail}
          onClose={() => dispatchSheets({ type: "close" })}
          className="modal"
        >
          {detailCard && (
            <div className="detail-body">
              <div className="detail-hero">
                <img src={detailCard.img} alt={detailCard.name} referrerPolicy="no-referrer" />
                <div className="veil" />
                <button className="detail-close" onClick={() => dispatchSheets({ type: "close" })}>
                  ✕
                </button>
              </div>
              <div className="dname">{detailCard.name}</div>
              <div className="area">
                {detailCard.area} · {detailCard.cat.join(" / ")} · {detailCard.cost}
                {detailCard.reviewCount != null && (
                  <> · {detailCard.reviewCount.toLocaleString()} reviews</>
                )}
                {detailCard.estimatedDuration != null && (
                  <> · ⏱ {detailCard.estimatedDuration < 60
                    ? `${detailCard.estimatedDuration} min`
                    : `${Math.round(detailCard.estimatedDuration / 60 * 10) / 10} hr`}</>
                )}
              </div>
              <div className="rows" style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
                {(detailCard.likeR || detailCard.noR).slice(0, 3).map((t) => (
                  <span key={t} className="chip">{t}</span>
                ))}
              </div>
              <ul>
                {detailCard.detail.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </BottomSheet>

        <BottomSheet
          open={sheets.addPlace}
          onClose={() => dispatchSheets({ type: "close" })}
        >
          <h3>Add a place</h3>
          <p className="sub">Search Google Maps to add a location to your swipe deck.</p>

          <input
            className="addplace-input"
            placeholder="Search places..."
            value={placeQuery}
            onChange={(e) => handlePlaceSearch(e.target.value)}
          />

          {placeError && <div className="addplace-error">{placeError}</div>}

          {placeLoading && <div className="addplace-status">Searching...</div>}

          {!placeLoading && placeResults.length > 0 && !placeSelected && (
            <div className="addplace-results">
              {placeResults.map((r) => (
                <button
                  key={r.placeId}
                  className="addplace-result"
                  onClick={() => { setPlaceSelected(r); setPlaceQuery(r.mainText); setPlaceResults([]); }}
                >
                  <span className="apr-main">{r.mainText}</span>
                  <span className="apr-sub">{r.secondaryText}</span>
                </button>
              ))}
            </div>
          )}

          {!placeLoading && placeResults.length === 0 && placeQuery.length >= 2 && !placeSelected && !placeError && (
            <div className="addplace-status">No results found</div>
          )}

          {placeSelected && (
            <div className="addplace-preview">
              <div className="addplace-preview-label">Selected place</div>
              <div className="addplace-preview-name">{placeSelected.mainText}</div>
              <div className="addplace-preview-sub">{placeSelected.secondaryText}</div>
              {placeSelected.mapImageUrl ? (
                <img className="addplace-map" src={placeSelected.mapImageUrl} alt="Map preview" />
              ) : (
                <div className="addplace-map addplace-map-placeholder">No map preview available</div>
              )}
            </div>
          )}

          <div className="actions">
            <button className="btn btn-secondary" onClick={() => dispatchSheets({ type: "close" })}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!placeSelected} onClick={handlePlaceConfirm}>
              Add to deck
            </button>
          </div>
        </BottomSheet>

        {(pipeline.phase === "generating" || pipeline.error) && (
          <div
            role="status"
            style={{
              position: "fixed",
              right: 16,
              bottom: 84,
              zIndex: 50,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: "10px 14px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
              fontSize: 13,
              color: "var(--fg)",
              maxWidth: 260,
            }}
          >
            {pipeline.phase === "generating" && (
              <>
                <div style={{ fontWeight: 600 }}>
                  {pipeline.expectedCount > 0
                    ? `Finding photos… ${pipeline.cards.length} of ${pipeline.expectedCount} spots ready`
                    : `Curating spots in ${dest || LISBON_FALLBACK}…`}
                </div>
                <button
                  onClick={() => navigate("/profile")}
                  style={{ background: "none", border: "none", padding: 0, marginTop: 4, color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  Manage trip →
                </button>
              </>
            )}
            {pipeline.error && pipeline.phase !== "generating" && (
              <div style={{ color: "var(--nom)" }}>
                {describeDeckFailure(pipeline.errorCode, dest)}
              </div>
            )}
          </div>
        )}

        <BottomSheet
          open={sheets.more}
          onClose={() => dispatchSheets({ type: "close" })}
        >
          <h3>Plan another itinerary?</h3>
          <p className="sub">Start a new trip and invite your group when you're ready.</p>
          <div className="actions">
            <button className="btn btn-secondary" onClick={() => dispatchSheets({ type: "close" })}>
              Not yet
            </button>
            <button className="btn btn-primary" onClick={() => navigate("/setup/step1")}>
              Start a trip
            </button>
          </div>
        </BottomSheet>

        <InviteCrewDialog
          open={inviteOpen}
          link={buildInviteLink(tripId)}
          onDismiss={dismissInvite}
        />
      </section>
  );
}
