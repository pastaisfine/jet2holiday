import { useNavigate } from "react-router-dom";
import { Crown } from "phosphor-react";
import { useAuth } from "../context/useAuth";
import ProgressBar from "../components/ProgressBar";

export default function SetupStep2Screen() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  return (
    <section className="screen active screen-setup">
      {/* Progress */}
      <div style={{ padding: "4px 4px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <ProgressBar value={66} />
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 10, whiteSpace: "nowrap" }}>2 / 3</span>
        </div>
      </div>

      {/* Heading */}
      <div style={{ padding: "12px 4px 0" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 800, color: "var(--fg)", letterSpacing: "-0.03em" }}>
          Who's coming?
        </h1>
        <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--muted)" }}>
          Invite your travel companions. They sign up or sign in to join your workspace and start swiping the same places.
        </p>
      </div>

      {/* Invite crew card */}
      <div className="bento-card" style={{ padding: 20 }}>
        {/* Current user */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--bg)", borderRadius: 16, border: "1px solid var(--border)", marginBottom: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--accent)", color: "var(--surface)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12 }}>
            {(profile?.username || "You").slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>
              {profile?.username || "You"}{" "}
              <span style={{ fontSize: 10, background: "var(--fg)", color: "var(--surface)", padding: "2px 6px", borderRadius: 999, marginLeft: 4 }}>
                you · leader
              </span>
            </div>
          </div>
          <Crown size={18} weight="fill" color="var(--accent)" title="Trip leader" />
        </div>

        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 4px", lineHeight: 1.5 }}>
          Your invite link appears as soon as the trip is created, on the deck
          screen. Continue to set your preferences first.
        </p>
      </div>

      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 24 }}
        onClick={() => navigate("/setup/step3")}
      >
        Next →
      </button>
    </section>
  );
}
