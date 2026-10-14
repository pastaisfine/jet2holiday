import { Link } from "react-router-dom";
import { Moon, SunDim } from "@phosphor-icons/react";
import { useAuth } from "../context/useAuth";

export default function AppHeader({ trip, back, backLabel, invert, theme, toggleTheme }) {
  const { user, profile } = useAuth();
  const initial = (profile?.username || user?.email || "U").slice(0, 1).toUpperCase();

  return (
    <header className={`appheader ${invert ? "invert" : ""}`}>
      <div className="hd-left">
        {back && <Link to={back} className="hd-back">‹ {backLabel || "Back"}</Link>}
        <Link to="/hub" className="hd-mark">jet2<b>holiday</b></Link>
        {trip && <span className="hd-trip">{trip}</span>}
      </div>
      <div className="hd-right">
        {toggleTheme && <button type="button" onClick={toggleTheme} className="theme-toggle-btn" title={theme === "dark" ? "Light Mode" : "Dark Mode"} aria-label={theme === "dark" ? "Light Mode" : "Dark Mode"}>{theme === "dark" ? <SunDim size={18} weight="bold" /> : <Moon size={18} weight="bold" />}</button>}
        <div className="hd-auth">
          {user ? <Link to="/profile" className="hd-user-btn" title={profile?.username || user.email}>{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="avatar" className="hd-avatar-img" /> : <span className="hd-avatar-initial">{initial}</span>}</Link> : <Link to="/login" className="hd-login-link">Log in</Link>}
        </div>
      </div>
    </header>
  );
}
