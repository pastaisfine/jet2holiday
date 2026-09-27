import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function ForgotPasswordScreen() {
  const { sendPasswordReset } = useAuth();

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMsg("Please enter your email address.");
      return;
    }

    setErrorMsg("");
    setSubmitting(true);

    try {
      await sendPasswordReset(trimmed);
      setSent(true);
    } catch (err) {
      const msg = err?.message || "";
      // Supabase returns a non-error for unknown emails to prevent enumeration,
      // but if an actual error slips through, surface it.
      setErrorMsg(msg || "Something went wrong. Please try again.");
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
            Reset your password
          </h1>
          <p className="splash-copy" style={{ fontSize: 13.5, margin: 0, color: "var(--muted)", maxWidth: "none" }}>
            {sent
              ? "Check your inbox for the reset link."
              : "Enter the email you registered with and we'll send you a password reset link."}
          </p>
        </div>

        <div className="bento-card auth-card" style={{ padding: "var(--card-pad)" }}>
          {sent ? (
            <div className="verify-notice">
              <div className="verify-icon">✉️</div>
              <h3 style={{ margin: "10px 0 6px", fontSize: 18 }}>Email sent!</h3>
              <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 18px" }}>
                We sent a password reset link to <b style={{ color: "var(--fg)" }}>{email.trim()}</b>.
                Please check your inbox (and spam folder) and click the link to set a new password.
              </p>
              <Link to="/login" className="btn btn-primary btn-block" style={{ textDecoration: "none", display: "block", textAlign: "center", lineHeight: "normal", padding: "13px 20px" }}>
                Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              {errorMsg && (
                <div className="auth-alert auth-alert-error" role="alert">
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label htmlFor="forgot-email">Email address</label>
                  <input
                    id="forgot-email"
                    className="input"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={submitting}
                  style={{ marginTop: 6 }}
                >
                  {submitting ? "Sending..." : "Send reset link"}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="auth-footer">
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "14px 0 0" }}>
            Remembered it?{" "}
            <Link to="/login" className="auth-link">
              Back to Sign In
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
