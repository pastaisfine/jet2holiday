import { useEffect, useState } from "react";
import { useAuth } from "../context/useAuth";

const ALL_YES = [
  { name: "Time Out Market", count: 4 },
  { name: "Miradouro de Santa Luzia", count: 4 },
];

const DIVIDED = [
  { name: "LX Factory", count: "2–2" },
  { name: "Pasteis de Belém", count: "2–2" },
  { name: "Park rooftop", count: "3–1" },
];

const NOBODY = [
  { name: "Alfama fado — Priya", count: "1" },
  { name: "Cervejaria Ramiro — Marcus", count: "1" },
];

const NOTABLE_MS = [
  { name: "Ben", v: 88 },
  { name: "Priya", v: 79 },
  { name: "Marcus", v: 78 },
];

const RULES = [
  "Nothing starts before 10am unless 3 of 4 agree",
  "A 'no' with a reason counts twice as loud",
  "Optional stops are never on the critical path",
  "Anyone can ask for a 15-minute reset; nobody argues",
];

export default function GroupScreen({ useAppState }) {
  const { profile } = useAuth();
  const userName = profile?.username || "Alice";
  const { likes, skips } = useAppState;
  const [barAnimate, setBarAnimate] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBarAnimate(true), 80);
    return () => clearTimeout(t);
  }, []);

  const aliceV = Math.max(0, Math.min(97, 91 + Math.round((likes - skips) * 2)));
  const ms = [{ name: userName, v: aliceV }, ...NOTABLE_MS];

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
              <div className="places" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {ALL_YES.map((p) => (
                  <div key={p.name} className="ovpc count">
                    <span className="c">{p.count}</span>
                    {p.name}
                  </div>
                ))}
              </div>
            </div>

            <div className="bento-card wide" style={{ padding: "var(--card-pad)" }}>
              <div className="bx-title">The group was divided</div>
              <div className="bx-sub" style={{ marginTop: 4 }}>Resolved by reason weight, not vibes.</div>
              <div className="places" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {DIVIDED.map((p) => (
                  <div key={p.name} className="ovpc count">
                    <span className="c">{p.count}</span>
                    {p.name}
                  </div>
                ))}
              </div>
            </div>

            <div className="bento-card wide" style={{ padding: "var(--card-pad)" }}>
              <div className="bx-title">Only one person loved</div>
              <div className="bx-sub" style={{ marginTop: 4 }}>One-vote loves become optional, never slots.</div>
              <div className="places" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {NOBODY.map((p) => (
                  <div key={p.name} className="ovpc count">
                    <span className="c">{p.count}</span>
                    {p.name}
                  </div>
                ))}
              </div>
            </div>

            <div className="bento-card sat wide" style={{ padding: "var(--card-pad)" }}>
              <div className="info">
                <h3>Per-person satisfaction</h3>
                <div className="card-sub" style={{ fontSize: 12.5, marginTop: 2 }}>
                  Everyone sits above the 75% floor.
                </div>
              </div>
            </div>

            <div className="bento-card full" style={{ padding: "var(--card-pad)" }}>
              <div className="bx-title">Satisfaction by person</div>
              <div className="member-sat" style={{ marginTop: 12 }}>
                {ms.map((m) => (
                  <div key={m.name} className="msrow">
                    <div className="top">
                      <b>{m.name}</b>
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