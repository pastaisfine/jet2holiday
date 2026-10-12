import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function DoneScreen({ useAppState }) {
  const navigate = useNavigate();
  const { likes, skips } = useAppState;
  const { profile } = useAuth();
  const userName = profile?.username || "Alice";

  return (
    <section className="screen active screen-done">
      <div className="done-wrap">
      {/* Top Header Area */}
      <div style={{ padding: "8px 4px 0" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--surface)", border: "1px solid var(--border)", padding: "4px 12px", borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
          <span>Swipes Completed · {userName}</span>
        </div>
        <h1 style={{ margin: "10px 0 0", fontSize: 26, fontWeight: 800, color: "var(--fg)", letterSpacing: "-0.03em" }}>
          You're done, {userName}.
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--muted)", lineHeight: 1.5, maxWidth: "42ch" }}>
          {likes} likes and {skips} skips are now weighted signals shaping the group plan.
        </p>
      </div>

      {/* Stats Bento */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <div className="bento-card" style={{ padding: "16px 12px", textAlign: "center", alignItems: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--gerund)", letterSpacing: "-0.02em" }}>{likes}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 2 }}>Liked</div>
        </div>
        <div className="bento-card" style={{ padding: "16px 12px", textAlign: "center", alignItems: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "var(--nom)", letterSpacing: "-0.02em" }}>{skips}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 2 }}>Skipped</div>
        </div>
      </div>

      {/* AI Preference Info Card */}
      <div className="bento-card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.02em" }}>
            The collective preference model
          </h3>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>
          Your feedback tunes an individual style profile. When the rest of your crew completes their swipes,
          jet2holiday synthesizes a consensus schedule where every person is at least 75% satisfied.
        </div>
      </div>

      {/* CTA */}
      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 8 }}
        onClick={() => navigate("/style")}
      >
        Reveal my travel style →
      </button>
      </div>
    </section>
  );
}