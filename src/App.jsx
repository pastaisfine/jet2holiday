import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./App.css";
import AppHeader from "./components/AppHeader";
import TabBar from "./components/TabBar";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/useAuth";
import DoneScreen from "./pages/DoneScreen";
import ForgotPasswordScreen from "./pages/ForgotPasswordScreen";
import GroupScreen from "./pages/GroupScreen";
import HubScreen from "./pages/HubScreen";
import JoinScreen from "./pages/JoinScreen";
import LoginScreen from "./pages/LoginScreen";
import PlanScreen from "./pages/PlanScreen";
import ProfileScreen from "./pages/ProfileScreen";
import RegisterScreen from "./pages/RegisterScreen";
import ResetPasswordScreen from "./pages/ResetPasswordScreen";
import SetupStep1Screen from "./pages/SetupStep1Screen";
import SetupStep2Screen from "./pages/SetupStep2Screen";
import SetupStep3Screen from "./pages/SetupStep3Screen";
import StyleScreen from "./pages/StyleScreen";
import SwipeScreen from "./pages/SwipeScreen";
import SwipeHistoryScreen from "./pages/SwipeHistoryScreen";
import TravelScreen from "./pages/TravelScreen";
import TravelSearchScreen from "./pages/TravelSearchScreen";
import TasksScreen from "./pages/TasksScreen";
import { useAppState } from "./state/useAppState";
import { fmtDateRange } from "./utils/date";

const CHROME = {
  "/":                 { header: false, tabs: false },
  "/setup/step1":      { header: true, invert: false, back: "/login", backLabel: "Back", tabs: false },
  "/setup/step2":      { header: true, invert: false, back: "/setup/step1", backLabel: "Back", tabs: false },
  "/setup/step3":      { header: true, invert: false, back: "/setup/step2", backLabel: "Back", tabs: false },
  "/hub":              { header: true, invert: true, tabs: true, active: "trip" },
  "/travel":           { header: true, invert: false, back: "/plan", backLabel: "Plan", tabs: true, active: "trip" },
  "/travel/search":    { header: true, invert: false, back: "/travel", backLabel: "Travel", tabs: true, active: "trip" },
  "/swipe":            { header: true, invert: false, back: "/setup/step3", backLabel: "Setup", tabs: true, active: "swipe" },
  "/swipe/history":    { header: true, invert: false, back: "/swipe", backLabel: "Swipe", tabs: false },
  "/done":             { header: true, invert: false, back: "/swipe", backLabel: "Swipe", tabs: false },
  "/style":            { header: true, invert: false, back: "/done", backLabel: "Done", tabs: false },
  "/plan":             { header: true, invert: false, back: "/hub", backLabel: "Trip", tabs: true, active: "plan" },
  "/group":            { header: true, invert: false, back: "/hub", backLabel: "Trip", tabs: true, active: "group" },
  "/tasks":            { header: true, invert: false, back: "/hub", backLabel: "Trip", tabs: true, active: "tasks" },
  "/login":            { header: true, invert: false, back: null, backLabel: "", tabs: false },
  "/register":         { header: true, invert: false, back: "/login", backLabel: "Sign in", tabs: false },
  "/profile":          { header: true, invert: false, back: "/hub", backLabel: "Trip", tabs: true, active: "profile" },
  "/forgot-password":  { header: true, invert: false, back: "/login", backLabel: "Sign in", tabs: false },
  "/reset-password":   { header: true, invert: false, back: "/forgot-password", backLabel: "Request link", tabs: false },
  "/join/:tripId":     { header: false, tabs: false },
};

/** Redirect root: unauthenticated → /login, authenticated → /setup/step1 */
function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="screen active" style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14 }}>Loading…</div>
      </div>
    );
  }
  return <Navigate to={user ? "/setup/step1" : "/login"} replace />;
}

/** Guard: redirect to /login if not authenticated */
function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="screen active" style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14 }}>Loading…</div>
      </div>
    );
  }
  if (!session) {
    return (
      <Navigate
        to="/login"
        state={{ returnTo: location.pathname + location.search, ...(location.state || {}) }}
        replace
      />
    );
  }
  return children;
}

// The /style screen's back target depends on where it was entered from: the
// swipe screen's locked card and the plan sheet pass state so the header's
// back button returns there; every other entrance keeps the configured Done
// screen, which is still the parent of the normal post-swipe flow.
function styleBackOverride(state) {
  if (state?.from === "swipe") return { back: "/swipe", backLabel: "Swipe" };
  if (state?.from === "plan") return { back: "/plan", backLabel: "Plan" };
  return null;
}

function ScreenFrame({ path, cfg, headerTrip, theme, toggleTheme, children }) {
  const location = useLocation();
  const override = path === "/style" ? styleBackOverride(location.state) : null;
  const back = override?.back ?? cfg.back;
  const backLabel = override?.backLabel ?? cfg.backLabel;

  return (
    <div className={`app${cfg.tabs ? " app--sidebar" : ""}`}>
      {cfg.header && (
        <AppHeader
          invert={cfg.invert}
          trip={headerTrip}
          back={back}
          backLabel={backLabel}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      )}
      {children}
      {cfg.tabs && <TabBar active={cfg.active} />}
    </div>
  );
}

function Shell() {
  const appState = useAppState();
  const dateRange = fmtDateRange(appState.startDate, appState.endDate);
  const trip = `${appState.dest || "Lisbon, Portugal"}${dateRange ? ` · ${dateRange}` : ""}`;
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

  useEffect(() => {
    // Flipping data-theme fires every colour transition on the page at once, so
    // the switch smears. Suppress transitions, apply the attribute, then restore
    // them after the next frame (see src/motion.css).
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
    }));
    return () => cancelAnimationFrame(raf);
  }, [theme]);

  const AUTH_PATHS = ["/setup/step1", "/setup/step2", "/setup/step3", "/login", "/register", "/forgot-password", "/reset-password"];

  const screens = {
    "/":                <RootRedirect />,
    "/setup/step1":     <RequireAuth><SetupStep1Screen useAppState={appState} /></RequireAuth>,
    "/setup/step2":     <RequireAuth><SetupStep2Screen useAppState={appState} /></RequireAuth>,
    "/setup/step3":     <RequireAuth><SetupStep3Screen useAppState={appState} /></RequireAuth>,
    "/hub":             <HubScreen useAppState={appState} />,
    "/travel":          <TravelScreen useAppState={appState} />,
    "/travel/search":   <TravelSearchScreen useAppState={appState} />,
    "/swipe":           <SwipeScreen useAppState={appState} />,
    "/swipe/history":   <RequireAuth><SwipeHistoryScreen /></RequireAuth>,
    "/done":            <DoneScreen useAppState={appState} />,
    "/style":           <StyleScreen useAppState={appState} />,
    "/plan":            <PlanScreen useAppState={appState} />,
    "/group":           <GroupScreen useAppState={appState} />,
    // The board is shared state keyed on auth.uid() and scoped by trip
    // membership, so an anonymous visitor can neither read nor write it. The
    // guard makes that a redirect instead of an empty screen full of buttons
    // that are guaranteed to fail.
    "/tasks":           <RequireAuth><TasksScreen useAppState={appState} /></RequireAuth>,
    "/login":           <LoginScreen />,
    "/register":        <RegisterScreen />,
    "/profile":         <ProfileScreen useAppState={appState} />,
    "/forgot-password": <ForgotPasswordScreen />,
    "/reset-password":  <ResetPasswordScreen />,
    "/join/:tripId":    <JoinScreen useAppState={appState} />,
  };

  return (
    <AuthProvider>
      <div className="stage">
        <div className="device">
          <BrowserRouter>
            <Routes>
              {Object.entries(CHROME).map(([path, cfg]) => (
                <Route
                  key={path}
                  path={path}
                  element={
                    <ScreenFrame
                      path={path}
                      cfg={cfg}
                      headerTrip={AUTH_PATHS.includes(path) ? "" : (cfg.trip || trip)}
                      theme={theme}
                      toggleTheme={() => setTheme((current) => current === "dark" ? "light" : "dark")}
                    >
                      {screens[path]}
                    </ScreenFrame>
                  }
                />
              ))}
              <Route path="/setup" element={<Navigate to="/setup/step1" replace />} />
            </Routes>
          </BrowserRouter>
        </div>
      </div>
    </AuthProvider>
  );
}

export default Shell;
