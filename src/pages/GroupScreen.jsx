import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "../context/useAuth";
import { getTripSwipes, getTripMembers, subscribeTripSwipes } from "../services/tripService";

export default function GroupScreen({ useAppState }) {
  const { profile } = useAuth();
  const { likes, skips, tripId } = useAppState;
  const [barAnimate, setBarAnimate] = useState(false);
  const [swipes, setSwipes] = useState([]);
  const [members, setMembers] = useState([]);

  useEffect(() => {
    const t = setTimeout(() => setBarAnimate(true), 80);
    return () => clearTimeout(t);
  }, []);

  const loadData = useCallback(async () => {
    if (!tripId) return;
    const [s, m] = await Promise.all([getTripSwipes(tripId), getTripMembers(tripId)]);
    setSwipes(s);
    setMembers(m);
  }, [tripId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime updates
  useEffect(() => {
    if (!tripId) return;
    return subscribeTripSwipes(tripId, loadData);
  }, [tripId, loadData]);

  // Compute group dynamics from real swipes
  const { allYes, divided, onlyOne, memberSatisfaction } = useMemo(() => {
    if (swipes.length === 0 || members.length === 0) {
      return { allYes: [], divided: [], onlyOne: [], memberSatisfaction: [] };
    }

    // Group swipes by card_name
    const byCard = {};
    swipes.forEach((s) => {
      if (!byCard[s.card_name]) byCard[s.card_name] = { likes: 0, skips: 0, users: new Set() };
      if (s.direction === "like") byCard[s.card_name].likes++;
      else byCard[s.card_name].skips++;
      byCard[s.card_name].users.add(s.user_id);
    });

    const totalMembers = members.length;
    const allYes = [];
    const divided = [];
    const onlyOne = [];

    Object.entries(byCard).forEach(([name, data]) => {
      if (data.likes === totalMembers && data.skips === 0) {
        allYes.push({ name, count: data.likes });
      } else if (data.likes >= 1 && data.skips >= 1) {
        divided.push({ name, count: `${data.likes}–${data.skips}` });
      } else if (data.likes === 1) {
        onlyOne.push({ name, count: "1" });
      }
    });

    // Member satisfaction: % of their liked cards that are also liked by majority
    const memberSatisfaction = members.map((m) => {
      const myLikes = swipes.filter((s) => s.user_id === m.userId && s.direction === "like").map((s) => s.card_name);
      if (myLikes.length === 0) return { name: m.username, v: 0, isUser: m.userId === profile?.id };
      const myGroupLikes = myLikes.filter((cn) => (byCard[cn]?.likes || 0) > totalMembers / 2);
      const v = Math.round((myGroupLikes.length / myLikes.length) * 100);
      return { name: m.username, v, isUser: m.userId === profile?.id };
    });

    return { allYes, divided, onlyOne, memberSatisfaction };
  }, [swipes, members, profile]);

  // Local user's satisfaction estimate if no DB swipes yet
  const localUserV = Math.max(0, Math.min(97, 91 + Math.round((likes - skips) * 2)));
  const userName = profile?.username || "You";

  const displaySatisfaction = memberSatisfaction.length > 0
    ? memberSatisfaction
    : [{ name: userName, v: localUserV, isUser: true }];

  const RULES = [
    "Nothing starts before 10am unless 3 of 4 agree",
    "A 'no' with a reason counts twice as loud",
    "Optional stops are never on the critical path",
    "Anyone can ask for a 15-minute reset; nobody argues",
  ];

  // Fallback data if no real swipes yet
  const showFallback = swipes.length === 0;

  return (
    <section className="screen active">
      <div className="group-body">
        <div>
          <h1 className="h-display" style={{ fontSize: 27 }}>Group dynamics</h1>
          <div className="eyebrow" style={{ marginTop: 4 }}>Overlap · drivers · rules of the road</div>
        </div>

        <div className="bento">
          <div className="bento-card wide" style={{ padding: "var(--card-pad)" }}>
            <div className="bx-title">Everyone said yes</div>
            <div className="bx-sub" style={{ marginTop: 4 }}>No friction — locked into the day.</div>
            {showFallback ? (
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
                Swipe data will appear here once members have swiped.
              </div>
            ) : (
              <div className="places" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {allYes.length > 0 ? allYes.map((p) => (
                  <div key={p.name} className="ovpc count">
                    <span className="c">{p.count}</span>
                    {p.name}
                  </div>
                )) : (
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>No unanimous agreements yet.</div>
                )}
              </div>
            )}
          </div>

          <div className="bento-card wide" style={{ padding: "var(--card-pad)" }}>
            <div className="bx-title">The group was divided</div>
            <div className="bx-sub" style={{ marginTop: 4 }}>Resolved by reason weight, not vibes.</div>
            {showFallback ? (
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>Swipe more to see disagreements.</div>
            ) : (
              <div className="places" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {divided.length > 0 ? divided.map((p) => (
                  <div key={p.name} className="ovpc count">
                    <span className="c">{p.count}</span>
                    {p.name}
                  </div>
                )) : (
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>No divided places yet.</div>
                )}
              </div>
            )}
          </div>

          <div className="bento-card wide" style={{ padding: "var(--card-pad)" }}>
            <div className="bx-title">Only one person loved</div>
            <div className="bx-sub" style={{ marginTop: 4 }}>One-vote loves become optional, never slots.</div>
            {showFallback ? (
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>Appears after multiple members swipe.</div>
            ) : (
              <div className="places" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {onlyOne.length > 0 ? onlyOne.map((p) => (
                  <div key={p.name} className="ovpc count">
                    <span className="c">{p.count}</span>
                    {p.name}
                  </div>
                )) : (
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>No solo picks yet.</div>
                )}
              </div>
            )}
          </div>

          <div className="bento-card sat wide" style={{ padding: "var(--card-pad)" }}>
            <div className="info">
              <h3>Per-person satisfaction</h3>
              <div className="card-sub" style={{ fontSize: 12.5, marginTop: 2 }}>
                {showFallback ? "Swipe data will fill this chart." : "Everyone sits above the 75% floor."}
              </div>
            </div>
          </div>

          <div className="bento-card full" style={{ padding: "var(--card-pad)" }}>
            <div className="bx-title">Satisfaction by person</div>
            <div className="member-sat" style={{ marginTop: 12 }}>
              {displaySatisfaction.map((m) => (
                <div key={m.name} className="msrow">
                  <div className="top">
                    <b>{m.name}{m.isUser ? " (you)" : ""}</b>
                    <span className="v">{m.v}/100</span>
                  </div>
                  <div className="bar">
                    <i style={barAnimate ? { width: `${m.v}%` } : { width: 0 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bento-card full" style={{ padding: "var(--card-pad)" }}>
          <div className="bx-title">House rules</div>
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            {RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}