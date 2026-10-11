import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/useAuth";
import { classifyResetLink, RESET_LINK_STATE } from "../lib/resetLink";

/** How long to wait for a recovery session before treating the link as spent. */
const GIVE_UP_MS = 8000;

/**
 * ResetPasswordScreen
 *
 * Supabase redirects the user here after they click the password-reset email
 * link. On a good link the URL carries an implicit-flow fragment
 * (#access_token=...&type=recovery) that the client exchanges for a session, and
 * we then call updatePassword({ password }). On a link that has already been
 * used, or expired, the auth server sends the user here with an
 * error=.../error_code=otp_expired instead -- in the fragment, not the query --
 * and no amount of waiting produces a session, so we detect that up front and
 * offer a fresh link rather than leaving a disabled form spinning forever.
 * classifyResetLink decides which of those two worlds we are in.
 */
export default function ResetPasswordScreen() {
  const navigate = useNavigate();
  const { updatePassword } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  // Judge the link once, from the URL we were handed, before waiting on any
  // session. A spent link has to be reported even though it never yields one.
  // The URL cannot change underneath us, so this is a mount-time constant.
  const [link, setLink] = useState(() => classifyResetLink(window.location.href));
  const [ready, setReady] = useState(false);

  // Wait for Supabase to process the recovery token from the URL hash.
  useEffect(() => {
    if (link.state === RESET_LINK_STATE.INVALID) return;

    let cancelled = false;

    // If there's already a session we're good.
    // Otherwise listen for the PASSWORD_RECOVERY event.
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data?.session) {
        setReady(true);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });

    // No session and no event ever arriving means the URL carried a token the
    // client could not redeem -- an expired one, a malformed one, or none at
    // all. Waiting on it forever is what made this screen a dead end, so stop
    // and ask for a new link instead. Generous, because a slow network on a
    // cold page load is the innocent version of the same silence.
    const giveUp = setTimeout(() => {
      setLink({
        state: RESET_LINK_STATE.INVALID,
        reason: "We couldn't verify this reset link. It may have expired or already been used.",
      });
    }, GIVE_UP_MS);

    return () => {
      cancelled = true;
      clearTimeout(giveUp);
      listener?.subscription?.unsubscribe?.();
    };
  }, [link]);

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
      await updatePassword(password);

      setSuccessMsg("Your password has been updated successfully!");
      // Give the user a moment to read the message, then redirect.
      setTimeout(() => navigate("/hub"), 2000);
    } catch (err) {
      setErrorMsg(err?.message || "Failed to update password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const invalidLink = link.state === RESET_LINK_STATE.INVALID;

  if (invalidLink) {
    return (
      <section className="screen active screen-auth">
        <div className="auth-wrap">
          <div className="auth-header">
            <div className="splash-mark" style={{ fontSize: 28, marginBottom: 4 }}>
              jet2<b>holiday</b>
            </div>
            <h1 className="h-display" style={{ fontSize: 24, margin: "0 0 6px" }}>
              Link no longer valid
            </h1>
          </div>

          <div className="bento-card auth-card" style={{ padding: "var(--card-pad)" }}>
            <div className="verify-notice">
              <div className="verify-icon">🔗</div>
              <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5, margin: "10px 0 18px" }}>
                {link.reason || "This reset link could not be used."}
              </p>
            </div>
            <Link to="/forgot-password" className="btn btn-primary btn-block" style={{ textDecoration: "none", display: "block", textAlign: "center", lineHeight: "normal", padding: "13px 20px" }}>
              Send me a new link
            </Link>
          </div>
        </div>
      </section>
    );
  }

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
