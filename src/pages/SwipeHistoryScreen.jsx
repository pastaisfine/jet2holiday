import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { supabase } from "../lib/supabase";
import { getUserSwipes, deleteSwipe } from "../services/tripService";

const LISBON_FALLBACK = "Lisbon, Portugal";

/**
 * Every place this member has judged, newest first, with each verdict editable.
 *
 * Undo on the deck covers the mistake you just made. This covers everything
 * else: a card swiped twenty minutes ago, or one judged in a session that is
 * long gone. Flipping a verdict is an UPDATE on the same row rather than a
 * delete-then-insert, which the partial unique indexes would reject anyway.
 *
 * Edits are refused once the leader has locked preferences. The client gate
 * here is the friendly half; `enforce_preferences_lock` is the half that
 * actually holds, so a stale page or a raw API call cannot slip past.
 */
export default function SwipeHistoryScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [locked, setLocked] = useState(false);

  // Scope resolution, the lock read and the fetch run as one chain so the
  // effect never sets state synchronously, and so the list is never rendered
  // against a scope that has not been resolved yet. The scope is read from
  // localStorage rather than passed in: it has to match the deck's own scope,
  // and the deck derives that the same way.
  useEffect(() => {
    if (!session?.user?.id) return undefined;
    let cancelled = false;

    (async () => {
      const raw = localStorage.getItem("tripder-state-v1");
      let stored = {};
      try {
        stored = raw ? JSON.parse(raw) : {};
      } catch {
        stored = {};
      }

      const id = stored.tripId || null;
      const destination = stored.dest || LISBON_FALLBACK;

      // A failed lock read fails open: the list still loads, just without the
      // banner. Every write is refused by the trigger regardless of this.
      let isLocked = false;
      if (id) {
        const { data } = await supabase
          .from("trips")
          .select("preferences_locked_at")
          .eq("id", id)
          .maybeSingle();
        isLocked = Boolean(data?.preferences_locked_at);
      }

      let result = [];
      let failure = "";
      try {
        result = await getUserSwipes({ tripId: id, destination });
      } catch (thrown) {
        failure = thrown?.message || "Could not load your picks.";
      }

      if (cancelled) return;
      setLocked(isLocked);
      setRows(result);
      setError(failure);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const flip = async (row) => {
    if (locked || busyId) return;
    const next = row.direction === "like" ? "skip" : "like";

    setBusyId(row.id);
    // Optimistic: the deck derives what is left from these rows, so the list and
    // the deck stay in step whether the write lands or is rolled back below.
    setRows((current) =>
      current.map((r) => (r.id === row.id ? { ...r, direction: next } : r))
    );

    const { error: failure } = await supabase
      .from("swipes")
      .update({ direction: next })
      .eq("id", row.id);

    if (failure) {
      setRows((current) =>
        current.map((r) => (r.id === row.id ? { ...r, direction: row.direction } : r))
      );
      setError("That pick could not be changed. Preferences may be locked.");
    }

    setBusyId(null);
  };

  const remove = async (row) => {
    if (locked || busyId) return;

    setBusyId(row.id);
    const gone = rows;
    setRows((current) => current.filter((r) => r.id !== row.id));

    const ok = await deleteSwipe(row.id);
    if (!ok) {
      setRows(gone);
      setError("That pick could not be removed. Preferences may be locked.");
    }

    setBusyId(null);
  };

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) =>
        String(b.swiped_at || "").localeCompare(String(a.swiped_at || ""))
      ),
    [rows]
  );

  return (
    <section className="screen active">
      <header className="screen-head">
        <div className="eyebrow">Swipe deck</div>
        <h1 className="h-display" style={{ fontSize: 26 }}>
          Your picks
        </h1>
        <p className="sub">
          Every place you kept or passed on. Change your mind here and it sticks.
        </p>
      </header>

      {locked && (
        <div className="bento-card" style={{ margin: "0 20px 12px", padding: 14 }}>
          <strong style={{ fontSize: 14 }}>Preferences locked</strong>
          <p className="sub" style={{ marginTop: 4 }}>
            The leader has built the plan, so these picks are frozen. Your
            itinerary is already built from them.
          </p>
        </div>
      )}

      {error && (
        <p className="sub" style={{ color: "var(--nom)", padding: "0 20px 12px" }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="sub" style={{ padding: "0 20px" }}>Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="swipe-history-empty">
          Nothing here yet. Every place you swipe will show up on this screen.
        </p>
      ) : (
        <div className="swipe-history">
          {sorted.map((row) => {
            const liked = row.direction === "like";
            return (
              <div className="swipe-history-row" key={row.id}>
                <span className="swipe-history-name">{row.card_name}</span>
                <span className={`swipe-history-tag ${liked ? "like" : "skip"}`}>
                  {liked ? "Kept" : "Passed"}
                </span>
                <button
                  className="swipe-history-btn"
                  onClick={() => flip(row)}
                  disabled={locked || busyId === row.id}
                >
                  {liked ? "Pass" : "Keep"}
                </button>
                <button
                  className="swipe-history-btn"
                  onClick={() => remove(row)}
                  disabled={locked || busyId === row.id}
                  aria-label={`Remove ${row.card_name}`}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="actions" style={{ padding: "4px 20px 32px" }}>
        <button className="btn btn-secondary" onClick={() => navigate("/swipe")}>
          Back to the deck
        </button>
      </div>
    </section>
  );
}