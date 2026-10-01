import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function RegisterScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.returnTo || "/setup/step1";
  const { signUp } = useAuth();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifySentEmail, setVerifySentEmail] = useState("");

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMsg("Please provide an email and password.");
      return;
    }
    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.");
      return;
    }

    setErrorMsg("");
    setSubmitting(true);

    try {
      const data = await signUp({
        email: email.trim(),
        password,
        username: username.trim(),
      });

      // If Supabase has email confirmation enabled, the session is null or confirmation is pending
      if (data?.user && (!data.session || !data.user.email_confirmed_at)) {
        setVerifySentEmail(email.trim());
      } else {
        // Direct login if confirmation is disabled in Supabase
        navigate(returnTo);
      }
    } catch (err) {
      const msg = err?.message || "";
      if (msg.toLowerCase().includes("user already registered")) {
        setErrorMsg("An account with this email already exists. Try signing in.");
      } else {
        setErrorMsg(msg || "Failed to create account. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="screen active screen-auth">
      <div className="auth-wrap">
        <div className="auth-header">
          <div className="splash-mark" style={{ fontSize: 28, marginBottom: 4 }}>
            jet2<b>holiday</b>
          </div>
          <h1 className="h-display" style={{ fontSize: 24, margin: "0 0 6px" }}>
            {verifySentEmail ? "Verify your email" : "Create your account"}
          </h1>
          <p className="splash-copy" style={{ fontSize: 13.5, margin: 0, color: "var(--muted)" }}>
            {verifySentEmail
              ? "One quick step to activate your jet2holiday account."
              : "Save your preferences and plan group trips with zero compromise."}
          </p>
        </div>

        <div className="bento-card auth-card" style={{ padding: "var(--card-pad)" }}>
          {verifySentEmail ? (
            <div className="verify-notice">
              <div className="verify-icon">✉️</div>
              <h3 style={{ margin: "10px 0 6px", fontSize: 18 }}>Check your inbox</h3>
              <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 18px" }}>
                We sent a verification link to <b style={{ color: "var(--fg)" }}>{verifySentEmail}</b>.
                Please open the link to verify your email before logging in.
              </p>
              <button
                className="btn btn-primary btn-block"
                onClick={() => navigate("/login")}
              >
                Proceed to Sign In
              </button>
            </div>
          ) : (
            <>
              {errorMsg && (
                <div className="auth-alert auth-alert-error" role="alert">
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleRegister}>
                <div className="field">
                  <label htmlFor="reg-username">Your name or handle</label>
                  <input
                    id="reg-username"
                    className="input"
                    type="text"
                    autoComplete="nickname"
                    placeholder="e.g. Alex"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <div className="hint">This name will appear on your group trip itineraries</div>
                </div>

                <div className="field">
                  <label htmlFor="reg-email">Email</label>
                  <input
                    id="reg-email"
                    className="input"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="field">
                  <label htmlFor="reg-password">Password</label>
                  <input
                    id="reg-password"
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={submitting}
                  style={{ marginTop: 6 }}
                >
                  {submitting ? "Creating account..." : "Sign up"}
                </button>
              </form>
            </>
          )}
        </div>

          <div className="auth-footer">
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "14px 0 0" }}>
              Already have an account?{" "}
              <Link to="/login" className="auth-link">
                Sign in
              </Link>
            </p>
          </div>

      </div>
    </section >
  );
}
