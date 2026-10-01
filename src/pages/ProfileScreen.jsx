import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { supabase } from "../lib/supabase";
import { resetPipeline } from "../services/generateTrip";

function ProfileDetailsForm({ profile, updateProfile }) {
  const [usernameInput, setUsernameInput] = useState(profile?.username || "");
  const [avatarUrlInput, setAvatarUrlInput] = useState(profile?.avatarUrl || "");
  const [profileMsg, setProfileMsg] = useState({ text: "", isError: false });
  const [savingProfile, setSavingProfile] = useState(false);

  const handleUpdateProfile = async (event) => {
    event.preventDefault();
    setProfileMsg({ text: "", isError: false });
    setSavingProfile(true);

    try {
      await updateProfile({ username: usernameInput.trim(), avatarUrl: avatarUrlInput.trim() });
      setProfileMsg({ text: "Profile updated successfully!", isError: false });
    } catch (error) {
      setProfileMsg({ text: error.message || "Failed to update profile.", isError: true });
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="bento-card" style={{ padding: "var(--card-pad)" }}>
      <div className="bx-title">Account Details</div>
      <div className="bx-sub" style={{ marginTop: 2, marginBottom: 14 }}>Manage how other group members see you in jet2holiday.</div>
      {profileMsg.text && <div className={`auth-alert ${profileMsg.isError ? "auth-alert-error" : "auth-alert-success"}`} style={{ marginBottom: 14 }}><span>{profileMsg.text}</span></div>}
      <form onSubmit={handleUpdateProfile}>
        <div className="field"><label htmlFor="prof-username">Display Name / Username</label><input id="prof-username" className="input" type="text" value={usernameInput} onChange={(event) => setUsernameInput(event.target.value)} placeholder="e.g. Alex" /></div>
        <div className="field"><label htmlFor="prof-avatar">Profile Image URL (optional)</label><input id="prof-avatar" className="input" type="url" value={avatarUrlInput} onChange={(event) => setAvatarUrlInput(event.target.value)} placeholder="https://example.com/avatar.jpg" /><div className="hint">Direct image URL for your profile photo</div></div>
        <button type="submit" className="btn btn-secondary btn-block" disabled={savingProfile}>{savingProfile ? "Saving changes..." : "Save Profile Details"}</button>
      </form>
    </div>
  );
}

export default function ProfileScreen({ useAppState }) {
  const navigate = useNavigate();
  const { user, profile, signOut, updateProfile, updatePassword } = useAuth();
  const { likes = 0, skips = 0, reasonCount = 0, styleName, resetTrip, pipelineDest } = useAppState || {};

  // Password change state
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdMsg, setPwdMsg] = useState({ text: "", isError: false });
  const [savingPwd, setSavingPwd] = useState(false);

  // Start over state (Q19/Q25/Q26/Q30)
  const [startOverOpen, setStartOverOpen] = useState(false);
  const [startOverBusy, setStartOverBusy] = useState(false);

  const handleResetTripOnly = () => {
    resetPipeline();
    resetTrip?.();
    setStartOverOpen(false);
    navigate("/setup/step1");
  };

  const handleResetEverything = async () => {
    setStartOverBusy(true);
    try {
      if (user?.id) {
        const { error } = await supabase.from("swipes").delete().eq("user_id", user.id);
        if (error) console.warn("Failed to delete swipe history:", error.message);
      }
    } finally {
      resetPipeline();
      resetTrip?.();
      setStartOverBusy(false);
      setStartOverOpen(false);
      navigate("/setup/step1");
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setPwdMsg({ text: "Password must be at least 6 characters long.", isError: true });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdMsg({ text: "Passwords do not match.", isError: true });
      return;
    }

    setPwdMsg({ text: "", isError: false });
    setSavingPwd(true);

    try {
      await updatePassword(newPassword);
      setPwdMsg({ text: "Password updated successfully!", isError: false });
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setShowPasswordChange(false), 2000);
    } catch (err) {
      setPwdMsg({ text: err.message || "Failed to update password.", isError: true });
    } finally {
      setSavingPwd(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/login");
    } catch (err) {
      console.error("Sign out error:", err);
    }
  };

  if (!user) {
    return (
      <section className="screen active screen-profile">
        <div className="profile-wrap">
          <div className="profile-header-area">
            <h1 className="h-display" style={{ fontSize: 26, margin: "0 0 6px" }}>
              Profile
            </h1>
            <p className="eyebrow">Your jet2holiday account &amp; preferences</p>
          </div>

          <div className="bento-card" style={{ padding: "var(--card-pad)", textAlign: "center" }}>
            <div
              className="avatar"
              style={{
                width: 58,
                height: 58,
                fontSize: 22,
                margin: "0 auto 14px",
                background: "var(--accent-soft)",
                color: "var(--accent)",
              }}
            >
              ?
            </div>
            <h3 style={{ fontSize: 18, margin: "0 0 6px" }}>You're exploring as a guest</h3>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 18px", lineHeight: 1.5 }}>
              Sign in or create an account to save your travel style, manage your profile, and sync group itineraries.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => navigate("/login")}
              >
                Sign In
              </button>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => navigate("/register")}
              >
                Register
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const initial = (profile?.username || user.email || "A").slice(0, 1).toUpperCase();

  return (
    <section className="screen active screen-profile">
      <div className="profile-wrap">
        <div className="profile-header-area">
          <h1 className="h-display" style={{ fontSize: 26, margin: "0 0 6px" }}>
            Profile
          </h1>
          <p className="eyebrow">Your jet2holiday account &amp; preferences</p>
        </div>

        {/* User Card */}
        <div className="bento-card profile-user-card" style={{ padding: "var(--card-pad)" }}>
          <div className="profile-hero-row">
            <div className="profile-avatar-wrap">
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.username} className="profile-avatar-img" />
              ) : (
                <div className="avatar profile-avatar-fallback" style={{ background: "var(--fg)", color: "var(--surface)", fontWeight: 700 }}>
                  {initial}
                </div>
              )}
            </div>
            <div className="profile-hero-info">
              <h2 style={{ fontSize: 19, margin: 0, fontWeight: 700 }}>
                {profile?.username || "Traveler"}
              </h2>
              <div className="profile-email-badge">
                <span>{user.email}</span>
                {profile?.isEmailVerified ? (
                  <span className="tag tag-ok" style={{ fontSize: 10, padding: "2px 7px" }}>
                    Verified
                  </span>
                ) : (
                  <span className="tag tag-warn" style={{ fontSize: 10, padding: "2px 7px" }}>
                    Pending
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <ProfileDetailsForm key={user.id} profile={profile} updateProfile={updateProfile} />

        {/* Password Section */}
        <div className="bento-card" style={{ padding: "var(--card-pad)" }}>
          <div className="bx-title">Password &amp; Security</div>
          <div className="bx-sub" style={{ marginTop: 2, marginBottom: 12 }}>
            Your password is secure and encrypted.
          </div>

          <div className="pwd-masked-row">
            <div className="pwd-masked-field">
              <span className="pwd-label">Password:</span>
              <span className="pwd-dots">••••••••••••</span>
            </div>
            <button
              type="button"
              className="btn btn-xs btn-secondary"
              onClick={() => setShowPasswordChange(!showPasswordChange)}
            >
              {showPasswordChange ? "Cancel" : "Change Password"}
            </button>
          </div>

          {showPasswordChange && (
            <form onSubmit={handleUpdatePassword} style={{ marginTop: 14 }}>
              {pwdMsg.text && (
                <div
                  className={`auth-alert ${pwdMsg.isError ? "auth-alert-error" : "auth-alert-success"}`}
                  style={{ marginBottom: 14 }}
                >
                  <span>{pwdMsg.text}</span>
                </div>
              )}

              <div className="field">
                <label htmlFor="new-pwd">New Password</label>
                <input
                  id="new-pwd"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="confirm-pwd">Confirm New Password</label>
                <input
                  id="confirm-pwd"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-type new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={savingPwd}
              >
                {savingPwd ? "Updating password..." : "Update Password"}
              </button>
            </form>
          )}
        </div>

        {/* Travel Persona & Swiping Stats */}
        <div className="bento-card" style={{ padding: "var(--card-pad)" }}>
          <div className="bx-title">jet2holiday Activity</div>
          <div className="bx-sub" style={{ marginTop: 2, marginBottom: 12 }}>
            Your current trip voting and persona signals.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {styleName && (
              <span className="chip sel">Style: {styleName}</span>
            )}
            <span className="chip">{likes} Likes</span>
            <span className="chip">{skips} Skips</span>
            <span className="chip">{reasonCount} Reasons</span>
          </div>
        </div>

        {/* Start Over (Q19/Q25) */}
        <div className="bento-card" style={{ padding: "var(--card-pad)" }}>
          <div className="bx-title">Trip</div>
          <div className="bx-sub" style={{ marginTop: 2, marginBottom: 12 }}>
            {pipelineDest ? `Current trip: ${pipelineDest}` : "Start fresh with a new destination."}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => setStartOverOpen(true)}
          >
            Start over
          </button>
        </div>

        {/* Sign Out Button */}
        <div style={{ padding: "4px 0 20px" }}>
          <button
            type="button"
            className="btn btn-block btn-secondary"
            onClick={handleSignOut}
            style={{ borderColor: "var(--border)", color: "var(--nom)" }}
          >
            Log out
          </button>
        </div>
      </div>

      {/* Q26/Q30: 3-button confirm modal */}
      {startOverOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
          onClick={() => !startOverBusy && setStartOverOpen(false)}
        >
          <div
            className="bento-card"
            style={{ padding: 20, maxWidth: 340, width: "100%", background: "var(--surface)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: 17 }}>Start over?</h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              Also delete your trip history from our servers? Your swipe history is used to shape future recommendations.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                disabled={startOverBusy}
                onClick={handleResetTripOnly}
              >
                Reset trip only
              </button>
              <button
                type="button"
                className="btn btn-block"
                disabled={startOverBusy}
                onClick={handleResetEverything}
                style={{ background: "var(--nom)", color: "var(--surface)", border: "none", borderRadius: 12, minHeight: 44, fontWeight: 700, cursor: "pointer" }}
              >
                {startOverBusy ? "Deleting…" : "Reset everything"}
              </button>
              <button
                type="button"
                className="btn btn-block"
                disabled={startOverBusy}
                onClick={() => setStartOverOpen(false)}
                style={{ background: "none", border: "none", color: "var(--muted)", minHeight: 36, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
