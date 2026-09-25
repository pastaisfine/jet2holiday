import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { MEMBERS, AVATAR_COLORS } from "../data/members";
import { TASKS } from "../data/tasks";
import { HOTELS, FLIGHTS, CAR_RENTALS } from "../data/travel";
import ProgressBar from "../components/ProgressBar";
import InfiniteSpiral from "../components/InfiniteSpiral";
import { fmtDateRange, dayCount } from "../utils/date";

export default function HubScreen({ useAppState }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const {
    likes, skips, reasonCount, styleSeen, styleName, dest, startDate, endDate, activeStops,
    hotel, flight, carRental, confirmedItineraryId
  } = useAppState;

  const hotelPicked = typeof hotel === "object" && hotel ? hotel : HOTELS.find((h) => h.id === hotel);
  const flightPicked = typeof flight === "object" && flight ? flight : FLIGHTS.find((f) => f.id === flight);
  const carPicked = typeof carRental === "object" && carRental ? carRental : CAR_RENTALS.find((c) => c.id === carRental);

  const mineDone = likes + skips > 0;
  const doneCount = 3 + (mineDone ? 1 : 0);
  const dateRange = fmtDateRange(startDate, endDate);
  const days = startDate && endDate ? dayCount(startDate, endDate) : 3;
  const spiralItems = useMemo(
    () => activeStops.map((stop) => ({ id: stop.id, src: stop.img, alt: stop.name })),
    [activeStops],
  );

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
          <h2 style={{ color: "#fff", margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", textShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>
            {dest || "Lisbon, Portugal"}
          </h2>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {dateRange && (
              <span style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(8px)", color: "#fff", padding: "4px 10px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>
                {dateRange}
              </span>
            )}
            <span style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(8px)", color: "#fff", padding: "4px 10px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>
              {days} days
            </span>
            <span style={{ background: "var(--accent)", color: "#000000", padding: "4px 10px", borderRadius: 999, fontSize: 13, fontWeight: 600 }}>
              4 friends
            </span>
          </div>
        </div>
      </div>

      <div className="hub-body">

        {/* 5. Shared Plan Ready / Confirmed Itinerary Section */}
        {styleSeen && !confirmedItineraryId && (
          <section style={{ ...cardStyle, background: "var(--bg)", border: "2px dashed var(--border)" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>Shared plan's ready</h3>
            <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.4 }}>
              See how we balanced everyone's tastes into one day you'll all say yes to.
            </div>
            <button style={{ ...primaryBtnStyle, marginTop: 8 }} onClick={() => navigate("/plan")}>
              View Shared Plan
            </button>
          </section>
        )}

        {confirmedItineraryId && (
          <section style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>Confirmed Itinerary</h3>
              <button style={secondaryBtnStyle} onClick={() => navigate("/plan")}>View map</button>
            </div>

            <div style={{ marginTop: 8, display: "flex", flexDirection: "column" }}>
              {activeStops.map((stop, i) => (
                <div key={stop.id} style={{ display: "flex", gap: 16 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 44 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)", padding: "4px 8px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>{stop.t}</span>
                    {i < activeStops.length - 1 && (
                      <div style={{ width: 2, flex: 1, minHeight: 24, background: "var(--border)", margin: "8px 0", borderRadius: 2 }}></div>
                    )}
                  </div>
                  <div style={{ flex: 1, fontSize: 15, paddingBottom: i < activeStops.length - 1 ? 24 : 0, paddingTop: 4, color: "var(--fg)", fontWeight: 500 }}>
                    {stop.name}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 2. Your Turn Section */}
        <section style={{ ...cardStyle, background: mineDone ? "var(--surface)" : "var(--fg)", color: mineDone ? "var(--fg)" : "var(--surface)" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>{mineDone ? "Your preferences saved" : "Your turn to swipe"}</h3>
            <div style={{ marginTop: 6, fontSize: 14, color: mineDone ? "var(--muted)" : "var(--surface)", lineHeight: 1.4 }}>
              {mineDone
                ? `${likes} liked, ${skips} skipped, ${reasonCount} reasons logged. We're tuning the itinerary to your taste.`
                : "9 places, ~2 minutes. Swipe right for want, left for skip. Add a reason and the AI learns."}
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
              { label: "Stay", value: hotelPicked?.name, fallback: "No accommodation picked" },
              { label: "Flight", value: flightPicked?.name, fallback: "No outbound flight picked" },
              { label: "Transport", value: carPicked?.name, fallback: "No transport picked" }
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg)", borderRadius: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--fg)" }}>{item.label}</span>
                <span style={{ fontSize: 14, color: item.value ? "var(--fg)" : "var(--muted)", fontWeight: item.value ? 500 : 400 }}>
                  {item.value || item.fallback}
                </span>
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
              const member = MEMBERS.find(m => m.k === task.assignedTo);
              const avatarColor = AVATAR_COLORS[task.assignedTo] || "var(--border)";
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
                  <div style={{ background: avatarColor, width: 28, height: 28, borderRadius: 999, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--surface)", fontWeight: 600 }}>
                    {member ? (member.k === "alice" ? (profile?.username || member.n) : member.n).slice(0, 1).toUpperCase() : "?"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 1. Who's Swiped Section */}
          <section style={cardStyle}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>Group alignment</h3>
              <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>
                {doneCount} of 4 swiped. Reveal unlocks when ready.
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
              {MEMBERS.map((m) => {
                const isUser = m.k === "alice";
                const memberName = isUser ? (profile?.username || m.n) : m.n;
                const finished = m.done || (isUser && mineDone);
                return (
                  <div key={m.k} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 64 }}>
                    <div style={{
                      background: finished ? m.c : "var(--bg)",
                      border: finished ? "none" : "2px dashed var(--border)",
                      color: finished ? "var(--surface)" : "var(--muted)",
                      width: 52, height: 52, borderRadius: 999, fontSize: 20,
                      display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600
                    }}>
                      {memberName.slice(0, 1).toUpperCase()}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)", marginTop: 8 }}>{memberName}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
                      marginTop: 4, color: finished ? "var(--fg)" : "var(--muted)",
                      background: finished ? "var(--accent)" : "transparent",
                      padding: "2px 6px", borderRadius: 4
                    }}>
                      {finished ? "Ready" : "Waiting"}
                    </span>
                  </div>
                );
              })}
            </div>
            <ProgressBar value={Math.round((doneCount / 4) * 100)} height={8} color="var(--fg)" bgColor="var(--bg)" />
          </section>

        </section>
      </div>
    </section>
  );
}