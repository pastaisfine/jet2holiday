import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export default function RequireAuth({ children }) {
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
    const isSetup = location.pathname === "/setup";
    return (
      <Navigate
        to="/login"
        state={{
          returnTo: location.pathname + location.search,
          ...(isSetup ? { action: "create_trip" } : {}),
          ...(location.state || {}),
        }}
        replace
      />
    );
  }

  return children;
}
