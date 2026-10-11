import { supabase } from "../lib/supabase";

/**
 * The shared task board.
 *
 * Every read and write here goes to Supabase; nothing about a task is cached
 * on the device. That is the whole point: a board that lives in localStorage
 * is invisible to everyone else, and the moment two people accept the same
 * task you get two truths.
 *
 * The three member columns are foreign keys onto public.profiles, so a single
 * select can embed every name the card shows. The embed aliases name the FK
 * explicitly because all three point at the same table and PostgREST cannot
 * otherwise tell them apart.
 */

const TASK_SELECT = `
  id,
  trip_id,
  title,
  description,
  status,
  created_by,
  assigned_to,
  assigned_by,
  created_at,
  updated_at,
  creator:profiles!trip_tasks_created_by_fkey(username, avatar_color),
  assignee:profiles!trip_tasks_assigned_to_fkey(username, avatar_color),
  assigner:profiles!trip_tasks_assigned_by_fkey(username, avatar_color)
`;

const DEFAULT_AVATAR = "#F19A6A";

/**
 * Maps a trip_tasks row to the shape the board renders.
 *
 * `assignedByName` is null when the holder picked the task up themselves, which
 * is the difference between "Priya claimed this" and "I gave Priya this" — two
 * very different things to the rest of the group, so they are not collapsed.
 */
export function taskRowToTask(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    description: row.description || "",
    status: row.status,
    createdBy: row.created_by,
    createdByName: row.creator?.username || "a member",
    createdByColor: row.creator?.avatar_color || DEFAULT_AVATAR,
    assignedTo: row.assigned_to || null,
    assignedToName: row.assignee?.username || "",
    assignedToColor: row.assignee?.avatar_color || DEFAULT_AVATAR,
    assignedBy: row.assigned_by || null,
    assignedByName: row.assigner?.username || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The provenance line under a card.
 *
 * "Completed by Ben" when Ben both held and closed it, and "Completed by Ben
 * for Alice" when the leader delegated it — otherwise a delegated task looks
 * like the creator quietly did the work themselves.
 */
export function taskMeta(task) {
  if (task.status === "done") {
    const holder = task.assignedToName || task.createdByName;
    if (task.assignedByName && task.assignedByName !== holder) {
      return `Completed by ${holder} for ${task.assignedByName}`;
    }
    return `Completed by ${holder}`;
  }
  if (task.status === "assigned") {
    if (task.assignedByName && task.assignedByName !== task.assignedToName) {
      return `Assigned to ${task.assignedToName} by ${task.assignedByName}`;
    }
    return `Accepted by ${task.assignedToName}`;
  }
  return `Added by ${task.createdByName}`;
}

/**
 * Splits the board into the three columns it renders, newest first within
 * each. Server order is authoritative (created_at DESC); this only partitions,
 * so a realtime refetch cannot reshuffle the board under the reader.
 */
export function groupTasks(tasks) {
  const open = [];
  const assigned = [];
  const done = [];
  for (const task of tasks || []) {
    if (task.status === "done") done.push(task);
    else if (task.status === "assigned") assigned.push(task);
    else open.push(task);
  }
  return { open, assigned, done };
}

/**
 * Whether the current user may act on a task they do not hold.
 *
 * `leaderId` is the trip's leader, not a property of the task — the board
 * renders both kinds of card with the same component, so it is passed in.
 *
 * The database enforces this too (enforce_task_transition), so this is about
 * not offering a button that is guaranteed to fail — the rule and the button
 * are kept in step deliberately, and the DB is the authority when they drift.
 */
export function canManageTask(task, userId, leaderId) {
  if (!userId) return false;
  return task.createdBy === userId || leaderId === userId;
}

/**
 * Resolves the agent's assignee guesses onto real members.
 *
 * The model returns a username it read out of the trip context. That is a
 * guess, not a reference: it may name someone who has since left, or misspell
 * a handle. Anything that does not resolve to a member of THIS trip becomes
 * null, which the schema reads as "open" — a dropped assignment is recoverable,
 * a task assigned to a stranger is not.
 */
export function resolveAssignees(parsedTasks, members) {
  const byName = new Map(
    (members || []).map((m) => [String(m.username || "").trim().toLowerCase(), m.userId]),
  );
  return (parsedTasks || []).map((task) => {
    const key = String(task.assignee || "").trim().toLowerCase();
    const userId = byName.get(key);
    return {
      title: task.title,
      description: task.description || "",
      assignedTo: userId || null,
    };
  });
}

export async function getTripTasks(tripId) {
  if (!tripId) return [];
  const { data, error } = await supabase
    .from("trip_tasks")
    .select(TASK_SELECT)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Error fetching trip tasks:", error.message);
    return [];
  }
  return (data || []).map(taskRowToTask);
}

/**
 * Writes the reviewed preview in one insert.
 *
 * Delegation at creation time is allowed even though only the creator can
 * *assign an existing* task: `assignedBy` is always the caller, so there is no
 * version of this that lets anyone else author on a member's behalf.
 */
export async function createTripTasks({ tripId, userId, tasks }) {
  if (!tripId || !userId || !tasks?.length) return [];

  const rows = tasks.map((task) => {
    const assignedTo = task.assignedTo || null;
    const delegated = assignedTo && assignedTo !== userId;
    return {
      trip_id: tripId,
      title: String(task.title || "").trim(),
      description: String(task.description || "").trim(),
      status: assignedTo ? "assigned" : "open",
      created_by: userId,
      assigned_to: assignedTo,
      assigned_by: delegated ? userId : null,
    };
  });

  // A blank title fails the table's CHECK constraint and would fail the whole
  // batch, taking the good rows down with it.
  const usable = rows.filter((row) => row.title.length > 0);
  if (usable.length === 0) return [];

  const { data, error } = await supabase
    .from("trip_tasks")
    .insert(usable)
    .select(TASK_SELECT);

  if (error) throw error;
  return (data || []).map(taskRowToTask);
}

async function patchTask(taskId, patch) {
  const { data, error } = await supabase
    .from("trip_tasks")
    .update(patch)
    .eq("id", taskId)
    .select(TASK_SELECT)
    .single();
  if (error) throw error;
  return taskRowToTask(data);
}

/** Claims an open task for yourself. */
export function acceptTask(taskId, userId) {
  return patchTask(taskId, {
    status: "assigned",
    assigned_to: userId,
    assigned_by: null,
  });
}

/** Hands a task back to the pool. Only the holder, creator or leader may. */
export function releaseTask(taskId) {
  return patchTask(taskId, {
    status: "open",
    assigned_to: null,
    assigned_by: null,
  });
}

/** Closes a task. Only the holder, creator or leader may. */
export function completeTask(taskId) {
  return patchTask(taskId, { status: "done" });
}

/** Delegates an open task to a named member. Creator or leader only. */
export function assignTask(taskId, assigneeId, byUserId) {
  const delegated = assigneeId && assigneeId !== byUserId;
  return patchTask(taskId, {
    status: "assigned",
    assigned_to: assigneeId,
    assigned_by: delegated ? byUserId : null,
  });
}

/** Pulls a delegation back into the pool without changing who authored it. */
export function unassignTask(taskId) {
  return patchTask(taskId, {
    status: "open",
    assigned_to: null,
    assigned_by: null,
  });
}

export async function deleteTask(taskId) {
  const { error } = await supabase.from("trip_tasks").delete().eq("id", taskId);
  if (error) throw error;
}

/**
 * Live board updates for a trip.
 *
 * The handler refetches rather than patching the payload in place: the board
 * needs names for three different FK columns and a stable newest-first order,
 * and a partial UPDATE payload carries none of that. A refetch is one small
 * query on a change that happens when someone clicks a button.
 */
export function subscribeTripTasks(tripId, onChange) {
  if (!tripId) return () => {};
  const channel = supabase
    .channel(`trip-tasks-${tripId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "trip_tasks", filter: `trip_id=eq.${tripId}` },
      onChange,
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}