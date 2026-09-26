import { useEffect, useState } from "react";

export default function StyleCard({ style, userName = "Alice", interestBreakdown = [] }) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimate(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="stylecard card">
      <div className="st">{userName} · your travel style</div>
      
      <h2>{style?.name || "Explorer"}</h2>
      
      <div className="who">
        {style?.tagline || "Your travel personality is inferred from your swipe decisions."}
      </div>
      
      <div className="trait">
        {interestBreakdown.map((b) => (
          <div key={b.name}>
            <div className="row">
              <b>{b.name}</b>
              <span className="v">{b.percent}%</span>
            </div>
            <div className="bar">
              <i style={animate ? { width: `${b.percent}%` } : { width: 0 }} />
            </div>
          </div>
        ))}
      </div>
      
      <div className="chipsline">
        {style?.pace && <span className="chip tag-ok">Pace · {style.pace}</span>}
        {style?.budget && <span className="chip">Budget · {style.budget}</span>}
        {style?.dining && style.dining !== "No preference" && (
          <span className="chip">Dining · {style.dining}</span>
        )}
      </div>
    </div>
  );
}