import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Crown } from "phosphor-react";
import { useAuth } from "../context/useAuth";
import ProgressBar from "../components/ProgressBar";

export default function SetupStep2Screen({ useAppState }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { tripId } = useAppState;
  const [copied, setCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const link = tripId
    ? `${window.location.origin}/join/${tripId}`
    : `${window.location.origin}/join/(create trip first)`;

  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setCopied(false); }
  };

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

        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
          You can share an invite link after your trip is created. For now, continue to set your preferences.
        </p>

        <button
          className="btn btn-secondary btn-block"
          style={{ marginTop: 4 }}
          onClick={() => setInviteOpen((o) => !o)}
        >
          {copied ? "Link Copied to Clipboard!" : "Share Invite Link"}
        </button>

        {inviteOpen && (
          <div style={{ marginTop: 10, padding: 14, background: "var(--bg)", borderRadius: 16, border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {tripId ? "Anyone with this link lands directly in your trip workspace." : "Complete setup first — the invite link will appear here."}
            </div>
            {tripId && (
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" readOnly value={link} style={{ flex: 1, fontSize: 11, padding: "0 10px", height: 38, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)" }} />
                <button className="btn btn-primary" style={{ minHeight: 38, padding: "0 14px", fontSize: 13 }} onClick={copyInvite}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
        )}
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
