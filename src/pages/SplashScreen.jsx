import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { ArrowRight } from "@phosphor-icons/react";

export default function SplashScreen() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  return (
    <section className="screen active screen-splash" style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      {/* Photo background */}
      <div className="splash-photo" style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <img
          src="/images/alfama.jpg"
          alt="Lisbon rooftops"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(29, 44, 26, 0.45) 0%, rgba(29, 44, 26, 0.1) 40%, rgba(29, 44, 26, 0.75) 100%)",
          }}
        />
      </div>

      {/* Top Brand Header */}
      <div style={{ position: "relative", zIndex: 2, padding: "28px 24px 0" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255, 255, 255, 0.2)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", padding: "6px 14px", borderRadius: 999, border: "1px solid rgba(255, 255, 255, 0.3)" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, color: "var(--on-photo)", letterSpacing: "-0.02em" }}>
            Trip<b style={{ color: "var(--accent)" }}>der</b>
          </span>
          <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--accent)" }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255, 255, 255, 0.9)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Group Travel
          </span>
        </div>
      </div>

      {/* Bottom Card: Warm Ivory Card resting on the surface */}
      <div style={{ position: "relative", zIndex: 2, padding: "16px 16px 24px" }}>
        <div
          style={{
            background: "var(--surface)",
            borderRadius: 28,
            padding: "26px 22px",
            border: "1px solid var(--border)",
            boxShadow: "0 20px 40px -15px rgba(25, 45, 30, 0.3)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
              Effortless alignment
            </span>
          </div>

          <h1
            style={{
              color: "var(--fg)",
              margin: 0,
              fontSize: 26,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            The group trip that everyone says yes to.
          </h1>

          <p
            style={{
              color: "var(--muted)",
              margin: 0,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Everyone swipes. Everyone says why. One collective itinerary nobody has to be talked into.
          </p>

          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            onClick={() => navigate("/setup")}
          >
            <span>Start a trip</span>
            <ArrowRight size={18} weight="bold" />
          </button>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 4 }}>
            {user ? (
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                Signed in as <strong style={{ color: "var(--fg)" }}>{profile?.username || user.email}</strong> ·{" "}
                <Link to="/profile" style={{ color: "var(--fg)", fontWeight: 600, textDecoration: "underline" }}>
                  Profile
                </Link>
              </span>
            ) : (
              <Link to="/login" style={{ fontSize: 13, color: "var(--muted)", textDecoration: "none" }}>
                Already have an account? <strong style={{ color: "var(--fg)", textDecoration: "underline" }}>Sign in</strong>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
