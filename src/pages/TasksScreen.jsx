import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  CircleNotch,
  Microphone,
  StopCircle,
} from "phosphor-react";
import { useAuth } from "../context/useAuth";
import { parseTasksFromMessage } from "../services/taskAgent";
import { getTrip, getTripMembers } from "../services/tripService";
import {
  acceptTask,
  assignTask,
  canManageTask,
  completeTask,
  createTripTasks,
  deleteTask,
  getTripTasks,
  groupTasks,
  releaseTask,
  resolveAssignees,
  subscribeTripTasks,
  taskMeta,
  unassignTask,
} from "../services/tasks";
import { supabase } from "../lib/supabase";

const STATUS_LABELS = {
  open: "Open",
  assigned: "Assigned",
  done: "Done ✓",
};

/**
 * The board is a projection of the database, not a copy of it.
 *
 * Every mutation goes to Supabase and comes back as a row; the realtime
 * subscription refetches so another member's click lands here too. There is no
 * local `setState` copy to reconcile, which is what used to go wrong — two
 * people could accept the same task and each see their own version as truth.
 */
function TaskCard({
  task,
  currentUserId,
  canManage,
  members,
  assigning,
  onAssign,
  onCancelAssign,
  onAccept,
  onComplete,
  onRelease,
  onUnassign,
  onRemove,
  busy,
}) {
  const isHolder = task.assignedTo === currentUserId;

  return (
    <div className={`task-card bento-card${task.status === "done" ? " task-card--done" : ""}`}>
      <div className="task-card-header">
        <span className={`task-status task-status--${task.status}`}>
          {STATUS_LABELS[task.status]}
        </span>
        <button
          className="task-remove"
          aria-label={`Remove task "${task.title}"`}
          onClick={() => onRemove(task.id)}
          disabled={busy}
        >
          ×
        </button>
      </div>

      <div className="task-card-title">{task.title}</div>
      {task.description && <div className="task-card-desc">{task.description}</div>}

      <div className="task-card-footer">
        <span className="task-card-meta">{taskMeta(task)}</span>
        <div className="task-card-actions">
          {task.status === "open" && !assigning && (
            <>
              <button
                className="btn btn-primary task-action-btn"
                onClick={() => onAccept(task.id)}
                disabled={busy}
              >
                Accept →
              </button>
              {canManage && (
                <button
                  className="btn btn-secondary task-action-btn"
                  onClick={() => onAssign(task.id)}
                  disabled={busy}
                >
                  Assign…
                </button>
              )}
            </>
          )}

          {task.status === "open" && assigning && (
            <div className="task-assign-row">
              <select
                className="input task-assign-select"
                aria-label={`Assign "${task.title}" to a member`}
                defaultValue=""
                onChange={(e) => e.target.value && onAssign(task.id, e.target.value)}
              >
                <option value="" disabled>
                  Pick a member…
                </option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.username}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-secondary task-action-btn"
                onClick={onCancelAssign}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          )}

          {task.status === "assigned" && (
            <>
              {(isHolder || canManage) && (
                <button
                  className="btn btn-secondary task-action-btn"
                  onClick={() => onComplete(task.id)}
                  disabled={busy}
                >
                  Mark done
                </button>
              )}
              {(isHolder || canManage) && (
                <button
                  className="btn btn-secondary task-action-btn"
                  onClick={() => (isHolder ? onRelease(task.id) : onUnassign(task.id))}
                  disabled={busy}
                >
                  {isHolder ? "Release" : "Unassign"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskSection({ title, tasks, children }) {
  if (tasks.length === 0) return null;
  return (
    <div className="task-section">
      <div className="task-section-head">
        <span className="bx-title">{title}</span>
        <span className="task-open-badge">{tasks.length}</span>
      </div>
      <div className="task-board">{children}</div>
    </div>
  );
}

export default function TasksScreen({ useAppState }) {
  const { profile } = useAuth();
  const currentUserId = profile?.id || null;
  const { dest, tripId } = useAppState;

  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [leaderId, setLeaderId] = useState(null);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [boardError, setBoardError] = useState("");
  const [busyTaskId, setBusyTaskId] = useState(null);
  const [assigningTaskId, setAssigningTaskId] = useState(null);

  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);

  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioChunksRef = useRef([]);
  // Lets a stop() that lands during unmount skip the transcription entirely.
  const aliveRef = useRef(true);

  const logsQueue = useRef([]);
  const logsInterval = useRef(null);
  const logsEndRef = useRef(null);

  /* ---------------------------------------------------------------- *
   * Board
   * ---------------------------------------------------------------- */

  const loadBoard = useCallback(async () => {
    if (!tripId) {
      setTasks([]);
      setLoadingBoard(false);
      return;
    }
    setLoadingBoard(true);
    try {
      setTasks(await getTripTasks(tripId));
      setBoardError("");
    } catch (err) {
      setBoardError(err.message || "Could not load the board.");
    } finally {
      setLoadingBoard(false);
    }
  }, [tripId]);

  // Roster and leader come from the trip, not from a device. The roster is
  // what the assignee picker offers and what the agent is told it may name;
  // the leader is the second half of "creator or leader may manage this".
  useEffect(() => {
    let cancelled = false;
    async function loadContext() {
      if (!tripId) {
        setMembers([]);
        setLeaderId(null);
        return;
      }
      const [roster, trip] = await Promise.all([
        getTripMembers(tripId),
        getTrip(tripId),
      ]);
      if (cancelled) return;
      setMembers(roster);
      setLeaderId(trip?.leader_id || null);
    }
    loadContext();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  // Another member accepting or completing a task should move this board
  // without a reload. The handler refetches rather than patching the payload:
  // an UPDATE event carries no profile names, and the card needs three.
  useEffect(() => {
    if (!tripId) return undefined;
    return subscribeTripTasks(tripId, loadBoard);
  }, [tripId, loadBoard]);

  /**
   * Runs one board mutation and lets the realtime echo be what re-renders.
   *
   * Nothing is applied locally on purpose: if the write is rejected — a member
   * trying to complete someone else's task, say — the server is the only thing
   * that knows, and a local optimistic update would have to be undone again.
   */
  const runAction = useCallback(
    async (taskId, action) => {
      setBusyTaskId(taskId);
      setBoardError("");
      try {
        await action();
      } catch (err) {
        setBoardError(err.message || "That did not work.");
      } finally {
        setBusyTaskId(null);
        setAssigningTaskId(null);
      }
    },
    [],
  );

  const handleAccept = useCallback(
    (taskId) => runAction(taskId, () => acceptTask(taskId, currentUserId)),
    [runAction, currentUserId],
  );

  const handleAssign = useCallback(
    (taskId, assigneeId) =>
      runAction(taskId, () => assignTask(taskId, assigneeId, currentUserId)),
    [runAction, currentUserId],
  );

  const handleComplete = useCallback(
    (taskId) => runAction(taskId, () => completeTask(taskId)),
    [runAction],
  );

  const handleRelease = useCallback(
    (taskId) => runAction(taskId, () => releaseTask(taskId)),
    [runAction],
  );

  const handleUnassign = useCallback(
    (taskId) => runAction(taskId, () => unassignTask(taskId)),
    [runAction],
  );

  const handleRemove = useCallback(
    (taskId) => runAction(taskId, () => deleteTask(taskId)),
    [runAction],
  );

  /* ---------------------------------------------------------------- *
   * Recording
   * ---------------------------------------------------------------- */

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // Leaving the screen mid-recording otherwise leaves the browser's
      // recording indicator on and the mic hot for the rest of the session.
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      streamRef.current = stream;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (!aliveRef.current) return;
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await handleTranscribe(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setError("");
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Could not access microphone.");
    }
  }

  function stopRecording() {
    // Guarded on the recorder's own state, not on `isRecording`: two clicks
    // inside one render both see `true`, and stop() on a stopped recorder
    // throws InvalidStateError.
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }

  async function handleTranscribe(audioBlob) {
    setTranscribing(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const { data, error: functionError } = await supabase.functions.invoke("transcribe-audio", {
        body: formData,
      });

      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);

      if (data?.text) {
        setMessage((prev) => (prev ? `${prev} ${data.text}` : data.text));
      }
    } catch (err) {
      console.error("Transcription error:", err);
      setError("Transcription failed: " + err.message);
    } finally {
      setTranscribing(false);
    }
  }

  // Smooth out log streaming
  useEffect(() => {
    if (loading) {
      logsInterval.current = setInterval(() => {
        if (logsQueue.current.length > 0) {
          const nextLog = logsQueue.current.shift();
          setLogs((prev) => [...prev, nextLog]);
        }
      }, 150);
    } else {
      clearInterval(logsInterval.current);
    }
    return () => clearInterval(logsInterval.current);
  }, [loading]);

  // Auto scroll to bottom of logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  /* ---------------------------------------------------------------- *
   * Agent
   * ---------------------------------------------------------------- */

  const openCount = (tasks.filter((t) => t.status === "open") || []).length;

  async function handleParse() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    setPreview(null);
    setLogs([]);
    logsQueue.current = [];
    try {
      const parsed = await parseTasksFromMessage(
        trimmed,
        {
          tripId,
          destination: dest || "our destination",
          members: members.map((m) => ({ username: m.username })),
          self: profile?.username || "",
        },
        (newLog) => {
          logsQueue.current.push(newLog);
        },
      );
      if (parsed.length === 0) {
        setError("No tasks found — try describing what still needs to be booked or organised.");
      } else {
        // Names the agent guessed become real member ids, or null. Anything it
        // invented is dropped rather than turned into a row nobody can own.
        setPreview(
          resolveAssignees(parsed, members).map((task) => ({
            ...task,
            key: crypto.randomUUID(),
            keep: true,
          })),
        );
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Check that the task agent is running.");
    } finally {
      setLoading(false);
      // Flush remaining logs instantly
      if (logsQueue.current.length > 0) {
        setLogs((prev) => [...prev, ...logsQueue.current]);
        logsQueue.current = [];
      }
    }
  }

  function handleConfirm() {
    if (!preview) return;
    const kept = preview.filter((t) => t.keep && t.title.trim());
    if (kept.length === 0) {
      setPreview(null);
      setError("Every task was unchecked — nothing was added.");
      return;
    }
    const rows = kept.map(({ title, description, assignedTo }) => ({
      title,
      description,
      assignedTo,
    }));
    createTripTasks({ tripId, userId: currentUserId, tasks: rows })
      .then(() => {
        setPreview(null);
        setLogs([]);
        setMessage("");
      })
      .catch((err) => {
        setError(err.message || "Could not add those tasks.");
      });
  }

  function updatePreview(key, patch) {
    setPreview((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      // Without this guard the shortcut fires a second parse while the first
      // is still streaming.
      if (loading || transcribing) return;
      handleParse();
    }
  }

  const { open, assigned, done } = groupTasks(tasks);
  const keptCount = (preview || []).filter((t) => t.keep && t.title.trim()).length;

  const renderCard = (task) => (
    <TaskCard
      key={task.id}
      task={task}
      currentUserId={currentUserId}
      canManage={canManageTask(task, currentUserId, leaderId)}
      members={members}
      assigning={assigningTaskId === task.id}
      busy={busyTaskId === task.id}
      onAssign={(id, assigneeId) =>
        assigneeId ? handleAssign(id, assigneeId) : setAssigningTaskId(id)
      }
      onCancelAssign={() => setAssigningTaskId(null)}
      onAccept={handleAccept}
      onComplete={handleComplete}
      onRelease={handleRelease}
      onUnassign={handleUnassign}
      onRemove={handleRemove}
    />
  );

  return (
    <section className="screen active screen-tasks">
      <style>{`
        @keyframes custom-spin { 100% { transform: rotate(360deg); } }
        .spin-anim { animation: custom-spin 1s linear infinite; }
      `}</style>
      {/* ── Agent chat section ── */}
      <div className="tasks-agent-wrap">
        <div className="tasks-section-head">
          <h1 className="h-display" style={{ fontSize: 27 }}>Group Tasks</h1>
          <div className="eyebrow" style={{ marginTop: 4 }}>
            Tell the agent what still needs doing — it will create tasks for the group.
          </div>
        </div>

        <div className="bento-card tasks-agent-card">
          <div className="bx-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle size={20} weight="bold" /> Ask the task agent
          </div>
          <div className="bx-sub" style={{ marginTop: 4 }}>
            Describe what hasn't been done yet. The agent will extract actionable tasks.
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
            <textarea
              className="task-input"
              style={{ flex: 1, margin: 0 }}
              rows={3}
              placeholder={`e.g. "The flight and hotel haven't been booked yet, and Priya still needs to sort transport."`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading || transcribing}
            />
            <button
              className={`btn ${isRecording ? "btn-danger" : "btn-secondary"}`}
              style={{ padding: "12px", height: "100%", minHeight: "86px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={loading || transcribing}
              title={isRecording ? "Stop recording" : "Record voice"}
            >
              {isRecording ? <StopCircle size={24} color="var(--danger, red)" weight="fill" /> : <Microphone size={24} />}
            </button>
          </div>

          {transcribing && (
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
              <CircleNotch size={14} className="spin-anim" /> Transcribing audio...
            </div>
          )}

          {error && <div className="task-error">{error}</div>}

          {!preview && (
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 12 }}
              onClick={handleParse}
              disabled={loading || transcribing || isRecording || !message.trim()}
            >
              {loading ? "Parsing…" : "Parse tasks →"}
            </button>
          )}

          {/* AI Logs Stream */}
          {(logs.length > 0 || loading) && !preview && (
            <div className="task-logs" style={{ marginTop: 16, fontSize: "0.85rem", color: "var(--text-muted)", background: "var(--bg-card)", padding: 8, borderRadius: 6, maxHeight: 150, overflowY: "auto", fontFamily: "monospace" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                {loading && <CircleNotch size={14} className="spin-anim" style={{ flexShrink: 0, marginTop: 2 }} />}
                <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
                  {logs.map((log, i) => (
                    <div key={i}>{log}</div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          )}

          {/* Editable preview of the agent's draft — drop, retitle, or hand a
              task to someone before anything is written. */}
          {preview && (
            <div className="task-preview">
              <div className="task-preview-label">
                Found {preview.length} task{preview.length !== 1 ? "s" : ""} — review before adding:
              </div>
              <div className="task-preview-list">
                {preview.map((t) => (
                  <div key={t.key} className="task-preview-item">
                    <div className="task-preview-edit">
                      <input
                        type="checkbox"
                        checked={t.keep}
                        onChange={(e) => updatePreview(t.key, { keep: e.target.checked })}
                        aria-label={`Add "${t.title}" to the board`}
                      />
                      <input
                        className="input task-preview-title-input"
                        value={t.title}
                        onChange={(e) => updatePreview(t.key, { title: e.target.value })}
                        aria-label="Task title"
                      />
                    </div>
                    {t.description && (
                      <div className="task-preview-desc">{t.description}</div>
                    )}
                    <div className="task-preview-edit">
                      <select
                        className="input task-preview-assignee"
                        value={t.assignedTo || ""}
                        onChange={(e) => updatePreview(t.key, { assignedTo: e.target.value || null })}
                        aria-label={`Who should take "${t.title}"?`}
                      >
                        <option value="">Anyone — leave open</option>
                        {members.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.username}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
              <div className="task-preview-actions">
                <button className="btn btn-primary" onClick={handleConfirm}>
                  Add {keptCount} task{keptCount !== 1 ? "s" : ""} to board ✓
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => { setPreview(null); setError(""); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Task board section ── */}
      <div className="tasks-board-wrap">
        <div className="tasks-board-head">
          <span className="bx-title">Task board</span>
          {openCount > 0 && <span className="task-open-badge">{openCount} open</span>}
        </div>

        {boardError && <div className="task-error">{boardError}</div>}

        {!tripId ? (
          <div className="task-empty">
            Finish setting up a trip first — the board is shared with the people going on it.
          </div>
        ) : loadingBoard ? (
          <div className="task-empty">Loading the board…</div>
        ) : tasks.length === 0 ? (
          <div className="task-empty">
            No tasks yet. Ask the agent above to create some!
          </div>
        ) : (
          <>
            <TaskSection title="Open" tasks={open}>
              {open.map(renderCard)}
            </TaskSection>
            <TaskSection title="Assigned" tasks={assigned}>
              {assigned.map(renderCard)}
            </TaskSection>
            <TaskSection title="Done" tasks={done}>
              {done.map(renderCard)}
            </TaskSection>
          </>
        )}
      </div>
    </section>
  );
}