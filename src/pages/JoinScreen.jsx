import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { getTrip, joinTrip, getTripDeckId, getDeckCards } from "../services/tripService";
import { supabase } from "../lib/supabase";
import { fmtDateRange } from "../utils/date";

export default function JoinScreen({ useAppState }) {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const { loadTrip, update, addedCards, pipelineCompleted, cardsDeckId } = useAppState;

  // Read through refs inside the join effect: subscribing to these values would
  // re-run the effect on every state write, and each run writes state.
  const addedCardsRef = useRef(addedCards);
  useEffect(() => {
    addedCardsRef.current = addedCards;
  }, [addedCards]);
  const pipelineCompletedRef = useRef(pipelineCompleted);
  useEffect(() => {
    pipelineCompletedRef.current = pipelineCompleted;
  }, [pipelineCompleted]);
  const cardsDeckIdRef = useRef(cardsDeckId);
  useEffect(() => {
    cardsDeckIdRef.current = cardsDeckId;
  }, [cardsDeckId]);

  const [trip, setTrip] = useState(null);
  const [hostName, setHostName] = useState("");
  const [loadingTrip, setLoadingTrip] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  // Load trip info
  useEffect(() => {
    if (!tripId) { setNotFound(true); setLoadingTrip(false); return; }
    getTrip(tripId).then(async (t) => {
      if (!t) { setNotFound(true); setLoadingTrip(false); return; }
      setTrip(t);

      // Fetch host profile
      if (t.leader_id) {
        const { data } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", t.leader_id)
          .maybeSingle();
        setHostName(data?.username || "the trip leader");
      }
      setLoadingTrip(false);
    });
  }, [tripId]);

  // If already logged in, auto-join and route appropriately
  useEffect(() => {
    if (authLoading || loadingTrip || !trip || !session?.user?.id) return;

    const doJoin = async () => {
      setJoining(true);
      try {
        const { trip: joinedTrip } = await joinTrip({ tripId, userId: session.user.id });
        const effectiveTrip = joinedTrip || trip;
        loadTrip(effectiveTrip);

        // The shared deck now lives in trip_cards, reached via the trip's deck
        // link. Reading trips.cards here would silently give an empty deck to
        // every new member, since generation no longer writes that column.
        const deckId = await getTripDeckId(tripId);
        const sharedCards = deckId ? await getDeckCards(deckId) : [];

        // Check whether this member has already judged places on this trip
        // before touching progress. An invite link is re-openable and gets
        // refreshed; wiping swipe state here was sending finished members back
        // to a full deck.
        const { data: existingSwipes } = await supabase
          .from("swipes")
          .select("id")
          .eq("trip_id", tripId)
          .eq("user_id", session.user.id)
          .limit(1);

        if (existingSwipes && existingSwipes.length > 0) {
          // Already swiped. Same deck: merge, so user-added places on this
          // device survive. Different deck (another trip, or none recorded):
          // replace, so a previous trip's cards cannot linger in this one.
          const sameDeck = Boolean(deckId) && cardsDeckIdRef.current === deckId;
          const knownIds = new Set((addedCardsRef.current || []).map((card) => card.id));
          const nextCards = sameDeck
            ? [
              ...(addedCardsRef.current || []),
              ...sharedCards.filter((card) => !knownIds.has(card.id)),
            ]
            : sharedCards;

          update({
            addedCards: nextCards,
            cardsDeckId: deckId || null,
            pipelineCompleted: sharedCards.length > 0 || pipelineCompletedRef.current,
            pipelineDest: effectiveTrip?.destination || "Lisbon, Portugal",
          });

          navigate("/hub");
          return;
        }

        // Reset swipe progress so the new member starts fresh with the workspace's shared card deck
        update({
          idx: 0,
          likes: 0,
          skips: 0,
          tagged: {},
          addedCards: sharedCards,
          cardsDeckId: deckId || null,
          pipelineCompleted: sharedCards.length > 0,
          pipelineDest: effectiveTrip?.destination || "Lisbon, Portugal",
          pipelineThinFallback: false,
        });

        // Check if this user has completed their personal preferences yet.
        // New joiners haven't gone through setup/step3, so send them there
        // first so they can set preferences before swiping.
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("preferences_completed")
          .eq("id", session.user.id)
          .maybeSingle();

        const prefsCompleted = profileRow?.preferences_completed === true;

        if (!prefsCompleted) {
          // Pass the tripId via state so Step 3 can attach to this joined trip
          navigate("/setup/step3", { state: { joinTripId: tripId } });
        } else {
          navigate("/swipe");
        }
      } catch (err) {
        setError(err.message || "Failed to join trip.");
        setJoining(false);
      }
    };

    doJoin();
  }, [authLoading, loadingTrip, trip, session, tripId, loadTrip, update, navigate]);

  const dateRange = trip ? fmtDateRange(trip.start_date, trip.end_date) : "";

  if (loadingTrip || authLoading) {
    return (
      <section className="screen active screen-auth">
        <div className="auth-wrap" style={{ justifyContent: "center", alignItems: "center" }}>
          <div className="eyebrow" style={{ textAlign: "center", color: "var(--muted)" }}>Loading trip…</div>
        </div>
      </section>
    );
  }

  if (notFound) {
    return (
      <section className="screen active screen-auth">
        <div className="auth-wrap">
          <div className="auth-header">
            <div className="splash-mark" style={{ fontSize: 28, marginBottom: 4 }}>Trip<b>der</b></div>
            <h1 className="h-display" style={{ fontSize: 24, margin: "0 0 6px" }}>Invite link not found</h1>
            <p style={{ fontSize: 13.5, color: "var(--muted)" }}>This invite link may have expired or been removed.</p>
          </div>
          <Link to="/" className="btn btn-primary btn-block" style={{ display: "block", textAlign: "center", textDecoration: "none", padding: "14px 20px" }}>
            Back to home
          </Link>
        </div>
      </section>
    );
  }

  // If authenticated, we're auto-joining (show spinner)
  if (session?.user?.id) {
    return (
      <section className="screen active screen-auth">
        <div className="auth-wrap" style={{ justifyContent: "center", alignItems: "center" }}>
          {error ? (
            <div className="auth-alert auth-alert-error" role="alert">{error}</div>
          ) : (
            <div className="eyebrow" style={{ textAlign: "center", color: "var(--muted)" }}>
              {joining ? "Joining workspace…" : "Checking your access…"}
            </div>
          )}
        </div>
      </section>
    );
  }

  // Not authenticated — show trip preview + sign-in prompt
  return (
    <section className="screen active screen-auth">
      <div className="auth-wrap">
        <div className="auth-header">
          <div className="splash-mark" style={{ fontSize: 28, marginBottom: 4 }}>Trip<b>der</b></div>
          <h1 className="h-display" style={{ fontSize: 22, margin: "0 0 4px" }}>You're invited!</h1>
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: 0 }}>
            {hostName ? `${hostName} invited you to plan a trip together.` : "You've been invited to a shared trip workspace."}
          </p>
        </div>

        {/* Trip preview card */}
        <div className="bento-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
            Trip workspace
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--fg)", letterSpacing: "-0.03em" }}>
            {trip?.destination || "Destination"}
          </div>
          {dateRange && (
            <div style={{ fontSize: 13.5, color: "var(--muted)" }}>{dateRange}</div>
          )}
          {hostName && (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Hosted by <b style={{ color: "var(--fg)" }}>{hostName}</b></div>
          )}
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0", lineHeight: 1.5 }}>
            Swipe places, add reasons, and let the group's votes build a shared itinerary everyone actually agrees on.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
          <Link
            to="/login"
            state={{ returnTo: `/join/${tripId}` }}
            className="btn btn-primary btn-block"
            style={{ display: "block", textAlign: "center", textDecoration: "none", padding: "14px 20px" }}
          >
            Sign in to join
          </Link>
          <Link
            to="/register"
            state={{ returnTo: `/join/${tripId}` }}
            className="btn btn-secondary btn-block"
            style={{ display: "block", textAlign: "center", textDecoration: "none", padding: "14px 20px" }}
          >
            Create account &amp; join
          </Link>
        </div>
      </div>
    </section>
  );
}
