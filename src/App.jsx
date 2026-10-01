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
  "/done":             { header: true, invert: false, back: "/swipe", backLabel: "Swipe", tabs: false },
  "/style":            { header: true, invert: false, back: "/done", backLabel: "Done", tabs: false },
  "/plan":             { header: true, invert: false, back: "/hub", backLabel: "Trip", tabs: true, active: "plan" },
  "/group":            { header: true, invert: false, back: "/hub", backLabel: "Trip", tabs: true, active: "group" },
  "/tasks":            { header: true, invert: false, back: "/hub", backLabel: "Trip", tabs: true, active: "tasks" },
  "/login":            { header: true, invert: false, back: null, backLabel: "", tabs: false },
  "/register":         { header: true, invert: false, back: "/login", backLabel: "Sign in", tabs: false },
  "/profile":          { header: true, invert: false, back: "/hub", backLabel: "Trip", tabs: true, active: "profile" },
  "/forgot-password":  { header: true, invert: false, back: "/login", backLabel: "Sign in", tabs: false },
  "/reset-password":   { header: true, invert: false, tabs: false },
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

function Shell() {
  const appState = useAppState();
  const dateRange = fmtDateRange(appState.startDate, appState.endDate);
  const trip = `${appState.dest || "Lisbon, Portugal"}${dateRange ? ` · ${dateRange}` : ""}`;
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const AUTH_PATHS = ["/setup/step1", "/setup/step2", "/setup/step3", "/login", "/register", "/forgot-password"];

  const screens = {
    "/":                <RootRedirect />,
    "/setup/step1":     <RequireAuth><SetupStep1Screen useAppState={appState} /></RequireAuth>,
    "/setup/step2":     <RequireAuth><SetupStep2Screen useAppState={appState} /></RequireAuth>,
    "/setup/step3":     <RequireAuth><SetupStep3Screen useAppState={appState} /></RequireAuth>,
    "/hub":             <HubScreen useAppState={appState} />,
    "/travel":          <TravelScreen useAppState={appState} />,
    "/travel/search":   <TravelSearchScreen useAppState={appState} />,
    "/swipe":           <SwipeScreen useAppState={appState} />,
    "/done":            <DoneScreen useAppState={appState} />,
    "/style":           <StyleScreen useAppState={appState} />,
    "/plan":            <PlanScreen useAppState={appState} />,
    "/group":           <GroupScreen useAppState={appState} />,
    "/tasks":           <TasksScreen useAppState={appState} />,
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
                    <div className={`app${cfg.tabs ? " app--sidebar" : ""}`}>
                      {cfg.header && (
                        <AppHeader
                          invert={cfg.invert}
                          trip={AUTH_PATHS.includes(path) ? "" : (cfg.trip || trip)}
                          back={cfg.back}
                          backLabel={cfg.backLabel}
                          theme={theme}
                          toggleTheme={() => setTheme((current) => current === "dark" ? "light" : "dark")}
                        />
                      )}
                      {screens[path]}
                      {cfg.tabs && <TabBar active={cfg.active} />}
                    </div>
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
