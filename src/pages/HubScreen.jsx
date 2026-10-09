import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { TASKS } from "../data/tasks";
import { HOTELS, FLIGHTS } from "../data/travel";
import ProgressBar from "../components/ProgressBar";
import InfiniteSpiral from "../components/InfiniteSpiral";
import { fmtDateRange, dayCount } from "../utils/date";
import { getTripMembers, getTripSwipes, subscribeTripMembers, subscribeTripSwipes } from "../services/tripService";
import { getTripPreferenceSummaries } from "../services/preference";
import { useGroupPlan, loadGroupPlan, startGroupPlan } from "../services/groupPlan";
import { ArrowSquareOut, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { CARD_DATA } from "../data/cards";

const FALLBACK_CARD_IDS = new Set(CARD_DATA.map((c) => c.id));

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hubDayLabel(dateValue) {
  if (!dateValue) return "Day";
  const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Day";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}.${day} ${DAYS_SHORT[date.getDay()]}`;
}

export default function HubScreen({ useAppState }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const {
    likes, skips, reasonCount, styleSeen, styleName, dest, startDate, endDate,
    hotel, flight, tripId, addedCards
  } = useAppState;
  const { plan, phase: planPhase, error: planError } = useGroupPlan();

  const hotelPicked = typeof hotel === "object" && hotel ? hotel : HOTELS.find((h) => h.id === hotel);
  const flightPicked = typeof flight === "object" && flight ? flight : FLIGHTS.find((f) => f.id === flight);

  const getShortHotelName = (name) => {
    if (!name) return "";

    const lower = name.toLowerCase();

    if (lower.startsWith("costa mahkota")) {
      return "Costa Mahkota";
    }

    if (lower.startsWith("doubletree")) {
      return "DoubleTree";
    }

    if (lower.startsWith("casa del rio")) {
      return "Casa Del Rio";
    }

    if (lower.startsWith("holiday inn")) {
      return "Holiday Inn";
    }

    if (lower.startsWith("swiss-garden")) {
      return "Swiss-Garden";
    }

    // Default: first 2 words
    return name.split(" ").slice(0, 2).join(" ");
  };

  const getHotelBookingUrl = (hotelName) => {
    if (!hotelName) return "#";

    return `https://www.google.com/travel/search?q=${encodeURIComponent(
      hotelName
    )}`;
  };


  const getFlightBookingUrl = (flightName) => {
    if (!flightName) return "#";

    return `https://www.google.com/travel/flights?q=${encodeURIComponent(
      flightName
    )}`;
  };


  const dateRange = fmtDateRange(startDate, endDate);
  const hasTripDates = Boolean(startDate && endDate);
  const days = hasTripDates ? dayCount(startDate, endDate) : null;

  // What the swipe screen is actually showing. Deck size tracks trip length, so
  // a fixed "9 places" here was wrong for every generated trip — and would have
  // been wrong by more the longer the trip got.
  const generatedCount = (addedCards || []).filter((c) => !FALLBACK_CARD_IDS.has(c.id)).length;
  const deckCount = generatedCount > 0 ? generatedCount : CARD_DATA.length;
  const swipePrompt = hasTripDates
    ? `${deckCount} places, ~${Math.max(2, Math.round(deckCount / 5))} minutes. Swipe right for want, left for skip. Add a reason and the AI learns.`
    : `${deckCount} sample places for now. Add your dates and we'll find the right number for your trip.`;

  const validated = plan?.validated_plan || null;
  const planDays = useMemo(() => validated?.days || [], [validated]);
  const confirmedAt = validated?.confirmed_at || null;

  const spiralItems = useMemo(
    () => planDays.flatMap((day) => day.stops.map((stop) => ({ id: `${day.day_index}-${stop.id}`, src: stop.img, alt: stop.name }))),
    [planDays],
  );

  // Real members from DB
  const [members, setMembers] = useState([]);
  const [swipes, setSwipes] = useState([]);
  const [summaries, setSummaries] = useState([]);

  const loadMembers = useCallback(async () => {
    if (!tripId) return;
    const m = await getTripMembers(tripId);
    setMembers(m);
  }, [tripId]);

  const loadSwipes = useCallback(async () => {
    if (!tripId) return;
    // A summary lands when a member finishes the preference analysis, which
    // usually follows their last swipe -- so the gate refreshes with the
    // swipes rather than on a separate effect nobody can see.
    const [s, profs] = await Promise.all([
      getTripSwipes(tripId),
      getTripPreferenceSummaries(tripId),
    ]);
    setSwipes(s);
    setSummaries(profs);
  }, [tripId]);

  useEffect(() => {
    loadGroupPlan(tripId);
    loadMembers();
    loadSwipes();
  }, [tripId, loadMembers, loadSwipes]);

  // Realtime subscriptions
  useEffect(() => {
    if (!tripId) return;
    const unsubMembers = subscribeTripMembers(tripId, loadMembers);
    const unsubSwipes = subscribeTripSwipes(tripId, loadSwipes);
    return () => { unsubMembers(); unsubSwipes(); };
  }, [tripId, loadMembers, loadSwipes]);

  // Compute who has swiped based on real swipes data
  const swipedUserIds = useMemo(() => {
    const ids = new Set();
    swipes.forEach((s) => ids.add(s.user_id));
    return ids;
  }, [swipes]);

  // The database is the authority on whether this member has swiped. Local
  // counters can be zero on a new device while the account has a full deck of
  // verdicts, and saying "Your turn to swipe" to someone who finished is the
  // same bug the swipe screen had.
  const mySwipeRows = useMemo(
    () => swipes.filter((s) => s.user_id === profile?.id),
    [swipes, profile?.id],
  );
  const displayLikes = likes + skips > 0 ? likes : mySwipeRows.filter((s) => s.direction === "like").length;
  const displaySkips = likes + skips > 0 ? skips : mySwipeRows.filter((s) => s.direction === "skip").length;
  const mineDone = displayLikes + displaySkips > 0;

  const totalMembers = members.length;
  const doneCount = members.filter((m) => swipedUserIds.has(m.userId)).length;
  // Make sure current user's local swipes count too
  const effectiveDoneCount = mineDone && profile?.id && !swipedUserIds.has(profile.id)
    ? doneCount + 1
    : doneCount;
  const effectiveTotalMembers = totalMembers || 1;

  // The group planner needs a summary from every member, not just a swipe
  // count: a member who swiped but has no analysis has no profile to balance.
  const summaryUserIds = useMemo(() => new Set(summaries.map((s) => s.user_id)), [summaries]);
  const profilesReady = members.filter((m) => summaryUserIds.has(m.userId)).length;
  const allProfilesReady = members.length > 0 && profilesReady >= members.length;
  const planInFlight = planPhase === "planning" || planPhase === "loading" || planPhase === "scheduling";
  const isLeader = useMemo(
    () => members.some((m) => m.userId === profile?.id && m.role === "leader"),
    [members, profile?.id],
  );
  const leaderName = useMemo(
    () => members.find((m) => m.role === "leader")?.username || "the trip creator",
    [members],
  );
  const includedMembers = useMemo(
    () => new Set(plan?.included_members || []),
    [plan?.included_members],
  );
  const planBuilt = plan?.status === "ready" || plan?.status === "confirmed";
  // Force-continue: the leader can build with whoever has finished. The button
  // needs at least one completed analysis to build from, not all of them.
  const canBuild = isLeader && profilesReady >= 1;

  // Deliberately not awaited: generation takes tens of seconds, and the plan
  // screen has its own progress states, so the user should land there at once.
  const buildPlan = () => {
    startGroupPlan({ tripId });
    navigate("/plan");
  };

  // Common card style based on brand-spec
  const cardStyle = {
    background: "var(--surface)",
    borderRadius: 24,
    padding: 20,
    border: "1px solid var(--border)",
    boxShadow: "0 8px 24px -12px rgba(0, 0, 0, 0.04)",
    display: "flex",
    flexDirection: "column",
    gap: 16
  };

  const primaryBtnStyle = {
    background: "var(--fg)",
    color: "var(--surface)",
    borderRadius: 999,
    padding: "14px 20px",
    fontWeight: 600,
    border: "none",
    fontSize: 15,
    cursor: "pointer",
    textAlign: "center",
    width: "100%",
    letterSpacing: "-0.01em"
  };

  const secondaryBtnStyle = {
    background: "var(--surface)",
    color: "var(--fg)",
    borderRadius: 999,
    border: "1px solid var(--border)",
    padding: "10px 16px",
    fontWeight: 500,
    fontSize: 14,
    cursor: "pointer",
    display: "inline-block",
    textAlign: "center"
  };

  // Copy invite link
  const inviteLink = tripId ? `${window.location.origin}/join/${tripId}` : null;
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    if (!inviteLink) return;
    try { await navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setCopied(false); }
  };

  return (
    <section className="screen active spiral-screen spiral-screen--hub" style={{ backgroundColor: "var(--bg)", minHeight: "100dvh" }}>
      <div className="spiral-backdrop" aria-hidden="true" style={{ opacity: 0.6 }}>
        <InfiniteSpiral
          items={spiralItems}
          speed={0.11}
          radius={270}
          cardWidth={182}
          cardHeight={124}
          verticalSpacing={100}
          cardsPerTurn={6}
          rotation={-12}
          cardTilt={4}
          cardRadius={20}
          centerScale={1.04}
          edgeFade={0.2}
          edgeBlur={9}
          grayscale={0.38}
          pauseOnHover={false}
        />
      </div>

      {/* Hero Section: Photo-led, compact metadata */}
      <div className="hub-hero">
        <img src="/images/miradouro-santa-luzia.jpg" alt="Lisbon" />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 60%)" }} />
        <div style={{ position: "absolute", bottom: 20, left: 20, right: 20 }}>
          <h2 style={{ color: "var(--on-photo)", margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", textShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>
            {dest || "Lisbon, Portugal"}
          </h2>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {dateRange && (
              <span style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(8px)", color: "var(--on-photo)", padding: "4px 10px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>
                {dateRange}
              </span>
            )}
            {days != null && (
              <span style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(8px)", color: "var(--on-photo)", padding: "4px 10px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>
                {days} {days === 1 ? "day" : "days"}
              </span>
            )}
            <span style={{ background: "var(--accent)", color: "var(--accent-ink)", padding: "4px 10px", borderRadius: 999, fontSize: 13, fontWeight: 600 }}>
              {effectiveTotalMembers} {effectiveTotalMembers === 1 ? "member" : "members"}
            </span>
          </div>
        </div>
      </div>

      <div className="hub-body">

        {/* Shared plan: gate, progress, confirmed itinerary */}
        {confirmedAt && validated ? (
          <section style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>Confirmed itinerary</h3>
              <button style={secondaryBtnStyle} onClick={() => navigate("/plan")}>View map</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {planDays.map((planDay) => (
                <div key={planDay.day_index}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--fg)" }}>{hubDayLabel(planDay.date)}</span>
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>{planDay.title}</span>
                    {planDay.overflow && <WarningCircle size={14} color="var(--warn)" />}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {planDay.stops.map((stop, i) => (
                      <div key={stop.id} style={{ display: "flex", gap: 16 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 58 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)", padding: "4px 8px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>{stop.t}</span>
                          {i < planDay.stops.length - 1 && (
                            <div style={{ width: 2, flex: 1, minHeight: 24, background: "var(--border)", margin: "8px 0", borderRadius: 2 }}></div>
                          )}
                        </div>
                        <div style={{ flex: 1, fontSize: 15, paddingBottom: i < planDay.stops.length - 1 ? 24 : 0, paddingTop: 4, color: "var(--fg)", fontWeight: 500 }}>
                          {stop.name}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : planInFlight ? (
          <section style={{ ...cardStyle, background: "var(--bg)", border: "2px dashed var(--border)" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>
              {planPhase === "scheduling" ? "Plotting the route…" : "Building your shared plan…"}
            </h3>
            <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.4 }}>
              {planPhase === "scheduling"
                ? "Mapbox is ordering each day and the scheduler is setting the times."
                : "The Group Planner is comparing everyone's summaries and finding the compromises."}
            </div>
            <button style={primaryBtnStyle} onClick={() => navigate("/plan")}>View progress</button>
          </section>
        ) : validated ? (
          <section style={{ ...cardStyle, background: "var(--bg)", border: "2px dashed var(--border)" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>Your shared plan is ready</h3>
            <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.4 }}>
              {planDays.length} day{planDays.length === 1 ? "" : "s"} balanced from everyone's swipes, routed and timed.
            </div>
            <button style={{ ...primaryBtnStyle, marginTop: 8 }} onClick={() => navigate("/plan")}>
              View shared plan
            </button>
          </section>
        ) : (
          <section style={{ ...cardStyle, background: "var(--bg)", border: "2px dashed var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkle size={18} weight="fill" color="var(--accent-deep)" />
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>The group plan</h3>
            </div>
            <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.4 }}>
              {allProfilesReady
                ? "Everyone's travel style is ready. Build the shared itinerary the whole group can review."
                : profilesReady > 0
                  ? `${profilesReady} of ${effectiveTotalMembers} travel styles ready. You can build now with whoever has finished — the rest can still view and vote on the plan.`
                  : "No travel styles are ready yet. A member's style unlocks once they finish swiping and review it."}
            </div>
            {planError && <div className="plan-error" role="alert">{planError}</div>}
            {isLeader ? (
              <button style={primaryBtnStyle} disabled={!canBuild} onClick={buildPlan}>
                {profilesReady === 0
                  ? "Waiting for the first traveller"
                  : allProfilesReady
                    ? "Build the group plan"
                    : `Build with ${profilesReady} of ${effectiveTotalMembers} ready`}
              </button>
            ) : (
              <button style={primaryBtnStyle} disabled>
                Waiting for {leaderName}
              </button>
            )}
          </section>
        )}

        {/* 2. Your Turn Section */}
        <section style={{ ...cardStyle, background: mineDone ? "var(--surface)" : "var(--fg)", color: mineDone ? "var(--fg)" : "var(--surface)" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>{mineDone ? "Your preferences saved" : "Your turn to swipe"}</h3>
            <div style={{ marginTop: 6, fontSize: 14, color: mineDone ? "var(--muted)" : "var(--surface)", lineHeight: 1.4 }}>
              {mineDone
                ? `${displayLikes} liked, ${displaySkips} skipped, ${reasonCount} reasons logged. We're tuning the itinerary to your taste.`
                : swipePrompt}
            </div>
          </div>

          {mineDone && styleSeen && (
            <div style={{ display: "inline-block", background: "var(--bg)", padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 500, color: "var(--fg)", border: "1px solid var(--border)", alignSelf: "flex-start" }}>
              Style: {styleName}
            </div>
          )}

          <button
            style={mineDone ? primaryBtnStyle : { ...primaryBtnStyle, background: "var(--surface)", color: "var(--fg)" }}
            onClick={() => {
              if (!mineDone) navigate("/swipe");
              else navigate("/style");
            }}
          >
            {!mineDone ? "Start Swiping" : styleSeen ? "Review My Swipes" : "Reveal My Travel Style"}
          </button>
        </section>

        {/* 3. Trip Basics Summary */}
        <section style={cardStyle}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>Trip basics</h3>
            <div style={{ marginTop: 4, fontSize: 14, color: "var(--muted)" }}>Logistics and bookings for the group.</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              {
                label: "Stay",
                value: getShortHotelName(hotelPicked?.name),
                fallback: "No accommodation picked"
              },
              {
                label: "Flight",
                value: flightPicked?.name,
                fallback: "No outbound flight picked"
              }
            ].map((item, i) => (

              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  padding: "20px 16px",
                  background: "var(--bg)",
                  borderRadius: 16
                }}
              >
                {/* Left side */}
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--fg)"
                  }}
                >
                  {item.label}
                </span>

                {/* Right side */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 10
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      color: item.value ? "var(--fg)" : "var(--muted)",
                      fontWeight: item.value ? 500 : 400
                    }}
                  >
                    {item.value || item.fallback}
                  </span>

                  {(
                    <button
                      onClick={() => {
                        const url =
                          item.label === "Stay"
                            ? getHotelBookingUrl(hotelPicked?.name)
                            : getFlightBookingUrl(flightPicked?.name);


                        window.open(url, "_blank");
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        background: "#e5e5e5",
                        border: "1px solid #666",
                        borderRadius: 8,
                        color: "#555",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      <ArrowSquareOut size={14} />
                      {item.label === "Stay" ? "Book now!" : "Book now!"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button style={secondaryBtnStyle} onClick={() => navigate("/travel")}>
            Manage Bookings
          </button>
        </section>


        {/* 4. Tasks Section */}
        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>Shared tasks</h3>
            <span style={{ fontSize: 12, fontWeight: 600, background: "var(--bg)", color: "var(--fg)", padding: "4px 10px", borderRadius: 999, border: "1px solid var(--border)" }}>
              {TASKS.filter(t => t.status === "done").length} / {TASKS.length}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {TASKS.map(task => {
              const isDone = task.status === "done";
              return (
                <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0" }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%",
                    border: `2px solid ${isDone ? "var(--fg)" : "var(--border)"}`,
                    background: isDone ? "var(--fg)" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}>
                    {isDone && <span style={{ color: "var(--surface)", fontSize: 12, fontWeight: "bold" }}>✓</span>}
                  </div>
                  <div style={{ flex: 1, textDecoration: isDone ? "line-through" : "none", color: isDone ? "var(--muted)" : "var(--fg)", fontSize: 15, fontWeight: isDone ? 400 : 500 }}>
                    {task.title}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 1. Who's Swiped Section — Real members */}
          <section style={cardStyle}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>Group alignment</h3>
              <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>
                {effectiveDoneCount} of {effectiveTotalMembers} swiped · {profilesReady} of {effectiveTotalMembers} profiles ready.
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
              {members.length > 0 ? members.map((m) => {
                const isUser = m.userId === profile?.id;
                const memberName = isUser ? (profile?.username || m.username) : m.username;
                const finished = swipedUserIds.has(m.userId) || (isUser && mineDone);
                const profiled = summaryUserIds.has(m.userId);
                const excluded = planBuilt && includedMembers.size > 0 && !includedMembers.has(m.userId);
                return (
                  <div key={m.userId} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 64 }}>
                    <div style={{
                      background: finished ? (m.avatarColor || "#F19A6A") : "var(--bg)",
                      border: finished ? "none" : "2px dashed var(--border)",
                      color: finished ? "var(--surface)" : "var(--muted)",
                      width: 52, height: 52, borderRadius: 999, fontSize: 20,
                      display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600,
                      opacity: excluded ? 0.55 : 1
                    }}>
                      {memberName.slice(0, 1).toUpperCase()}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)", marginTop: 8 }}>{memberName}{isUser ? " (you)" : ""}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
                      marginTop: 4, color: excluded ? "var(--surface)" : profiled ? "var(--fg)" : "var(--muted)",
                      background: excluded ? "var(--muted)" : profiled ? "var(--accent)" : "transparent",
                      padding: "2px 6px", borderRadius: 4
                    }}>
                      {excluded ? "Not in plan" : profiled ? "Profiled" : finished ? "Swiped" : "Waiting"}
                    </span>
                  </div>
                );
              }) : (
                // Fallback: just show current user if no trip members loaded yet
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 64 }}>
                  <div style={{
                    background: mineDone ? "#F19A6A" : "var(--bg)",
                    border: mineDone ? "none" : "2px dashed var(--border)",
                    color: mineDone ? "var(--surface)" : "var(--muted)",
                    width: 52, height: 52, borderRadius: 999, fontSize: 20,
                    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600
                  }}>
                    {(profile?.username || "Y").slice(0, 1).toUpperCase()}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)", marginTop: 8 }}>{profile?.username || "You"}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
                    marginTop: 4, color: mineDone ? "var(--fg)" : "var(--muted)",
                    background: mineDone ? "var(--accent)" : "transparent",
                    padding: "2px 6px", borderRadius: 4
                  }}>
                    {mineDone ? "Ready" : "Waiting"}
                  </span>
                </div>
              )}
            </div>
            <ProgressBar value={Math.round((effectiveDoneCount / effectiveTotalMembers) * 100)} height={8} color="var(--fg)" bgColor="var(--bg)" />

            {/* Share invite link in Hub */}
            {inviteLink && (
              <button
                style={secondaryBtnStyle}
                onClick={copyLink}
              >
                {copied ? "Invite Link Copied! ✓" : "Invite More Friends →"}
              </button>
            )}
          </section>

        </section>
      </div>
    </section>
  );
}
