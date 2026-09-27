import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * ResetPasswordScreen
 *
 * Supabase redirects the user here after they click the password-reset email
 * link. The URL contains a fragment (#access_token=...&type=recovery).
 * supabase.auth.onAuthStateChange fires a PASSWORD_RECOVERY event which sets
 * the session automatically — we just need to call updateUser({ password }).
 */
export default function ResetPasswordScreen() {
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [ready, setReady] = useState(false);

  // Wait for Supabase to process the recovery token from the URL hash.
  useEffect(() => {
    // If there's already a session with type=recovery we're good.
    // Otherwise listen for the PASSWORD_RECOVERY event.
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) {
        setReady(true);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });

    return () => listener?.subscription?.unsubscribe?.();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords do not match. Please re-enter them.");
      return;
    }

    setErrorMsg("");
    setSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setSuccessMsg("Your password has been updated successfully!");
      // Give the user a moment to read the message, then redirect.
      setTimeout(() => navigate("/hub"), 2000);
    } catch (err) {
      setErrorMsg(err?.message || "Failed to update password. Please try again.");
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
            Set a new password
          </h1>
          <p className="splash-copy" style={{ fontSize: 13.5, margin: 0, color: "var(--muted)", maxWidth: "none" }}>
            Choose a strong password for your jet2holiday account.
          </p>
        </div>

        <div className="bento-card auth-card" style={{ padding: "var(--card-pad)" }}>
          {successMsg ? (
            <div className="verify-notice">
              <div className="verify-icon">✅</div>
              <h3 style={{ margin: "10px 0 6px", fontSize: 18 }}>Password updated!</h3>
              <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5, margin: 0 }}>
                {successMsg} Redirecting you now…
              </p>
            </div>
          ) : (
            <>
              {errorMsg && (
                <div className="auth-alert auth-alert-error" role="alert">
                  <span>{errorMsg}</span>
                </div>
              )}

              {!ready && (
                <div className="auth-alert" style={{ background: "var(--bg-alt)", border: "1px solid var(--border)", color: "var(--muted)", padding: "10px 14px", borderRadius: "var(--r-control)", fontSize: 13, marginBottom: 14 }}>
                  Verifying your reset link…
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label htmlFor="reset-password">New password</label>
                  <input
                    id="reset-password"
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={!ready || submitting}
                    required
                  />
                </div>

                <div className="field">
                  <label htmlFor="reset-confirm">Confirm new password</label>
                  <input
                    id="reset-confirm"
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Re-enter your new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={!ready || submitting}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={!ready || submitting}
                  style={{ marginTop: 6 }}
                >
                  {submitting ? "Updating…" : "Update password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
