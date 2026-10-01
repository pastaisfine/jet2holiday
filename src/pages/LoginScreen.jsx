import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function LoginScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.returnTo || "/setup/step1";
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMsg("Please enter both your email and password.");
      return;
    }

    setErrorMsg("");
    setSubmitting(true);

    try {
      const data = await signIn({ email: email.trim(), password });
      if (data?.user && !data.user.email_confirmed_at && data.session === null) {
        setErrorMsg(
          "Your email address is not verified yet. Please check your inbox and confirm your email before signing in."
        );
        setSubmitting(false);
        return;
      }
      navigate(returnTo);
    } catch (err) {
      const msg = err?.message || "";
      if (msg.toLowerCase().includes("invalid login credentials")) {
        setErrorMsg("Incorrect email or password. Please try again.");
      } else if (msg.toLowerCase().includes("email not confirmed")) {
        setErrorMsg("Your email has not been verified yet. Please check your email for the confirmation link.");
      } else {
        setErrorMsg(msg || "Failed to sign in. Please check your connection and try again.");
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
            Welcome back
          </h1>
          <p className="splash-copy" style={{ fontSize: 13.5, margin: 0, color: "var(--muted)", maxWidth: "none" }}>
            Sign in to access your trips and collaborate with your group.
          </p>
        </div>

        <div className="bento-card auth-card" style={{ padding: "var(--card-pad)" }}>
          {errorMsg && (
            <div className="auth-alert auth-alert-error" role="alert">
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div className="field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <label htmlFor="login-password">Password</label>
                <Link to="/forgot-password" className="auth-link-subtle" style={{ fontSize: 12 }}>
                  Forgot password?
                </Link>
              </div>
              <input
                id="login-password"
                className="input"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
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
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>

        <div className="auth-footer">
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "14px 0 0" }}>
            Don't have an account?{" "}
            <Link to="/register" className="auth-link">
              Create an account
            </Link>
          </p>
        </div>

      </div>

    </section>
  );
}
