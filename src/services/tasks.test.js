import { describe, expect, it } from "vitest";
import {
  canManageTask,
  groupTasks,
  resolveAssignees,
  taskMeta,
  taskRowToTask,
} from "./tasks.js";

const ROW = {
  id: "t1",
  trip_id: "trip-1",
  title: "Book flights",
  description: "",
  status: "open",
  created_by: "alice",
  assigned_to: null,
  assigned_by: null,
  created_at: "2026-10-01T00:00:00Z",
  creator: { username: "alice", avatar_color: "#111111" },
  assignee: null,
  assigner: null,
};

describe("taskRowToTask", () => {
  it("reads names off the embedded profile, not off the id", () => {
    const task = taskRowToTask(ROW);
    expect(task.createdByName).toBe("alice");
    expect(task.createdByColor).toBe("#111111");
    expect(task.assignedTo).toBeNull();
    expect(task.assignedToName).toBe("");
  });

  it("copes with an embed that came back empty", () => {
    // A profile row can disappear between the task and the join; the card
    // still has to render something rather than "undefined".
    const task = taskRowToTask({ ...ROW, creator: null });
    expect(task.createdByName).toBe("a member");
    expect(task.createdByColor).toBe("#F19A6A");
  });
});

describe("taskMeta", () => {
  it("names the author of an open task", () => {
    expect(taskMeta(taskRowToTask(ROW))).toBe("Added by alice");
  });

  it("distinguishes a self-claim from a delegation", () => {
    const claimed = taskRowToTask({
      ...ROW,
      status: "assigned",
      assigned_to: "bob",
      assignee: { username: "bob" },
      assigner: null,
    });
    expect(taskMeta(claimed)).toBe("Accepted by bob");

    const delegated = taskRowToTask({
      ...ROW,
      status: "assigned",
      assigned_to: "bob",
      assignee: { username: "bob" },
      assigner: { username: "alice" },
    });
    expect(taskMeta(delegated)).toBe("Assigned to bob by alice");
  });

  it("credits the holder, not the delegator, on a completed task", () => {
    const task = taskRowToTask({
      ...ROW,
      status: "done",
      assigned_to: "bob",
      assignee: { username: "bob" },
      assigner: { username: "alice" },
    });
    expect(taskMeta(task)).toBe("Completed by bob for alice");
  });

  it("falls back to the creator when a done task has no holder", () => {
    expect(taskMeta(taskRowToTask({ ...ROW, status: "done" }))).toBe("Completed by alice");
  });

  it("does not say 'by bob for bob'", () => {
    const task = taskRowToTask({
      ...ROW,
      status: "done",
      assigned_to: "bob",
      assignee: { username: "bob" },
      assigner: { username: "bob" },
    });
    expect(taskMeta(task)).toBe("Completed by bob");
  });
});

describe("groupTasks", () => {
  it("partitions without reordering", () => {
    const tasks = [
      { id: "a", status: "done" },
      { id: "b", status: "open" },
      { id: "c", status: "assigned" },
      { id: "d", status: "open" },
    ];
    const { open, assigned, done } = groupTasks(tasks);
    expect(open.map((t) => t.id)).toEqual(["b", "d"]);
    expect(assigned.map((t) => t.id)).toEqual(["c"]);
    expect(done.map((t) => t.id)).toEqual(["a"]);
  });

  it("survives an undefined list", () => {
    expect(groupTasks(undefined)).toEqual({ open: [], assigned: [], done: [] });
  });

  it("sends an unknown status to open rather than dropping the card", () => {
    // Silently discarding a task is worse than showing it in the wrong column:
    // the board would look emptier than the database actually is.
    const { open } = groupTasks([{ id: "x", status: "archived" }]);
    expect(open.map((t) => t.id)).toEqual(["x"]);
  });
});

describe("canManageTask", () => {
  const task = { createdBy: "alice" };

  it("lets the creator manage their own task", () => {
    expect(canManageTask(task, "alice", "carol")).toBe(true);
  });

  it("lets the trip leader manage anyone's task", () => {
    expect(canManageTask(task, "carol", "carol")).toBe(true);
  });

  it("does not let an unrelated member manage it", () => {
    expect(canManageTask(task, "bob", "carol")).toBe(false);
  });

  it("manages nobody when there is no signed-in user", () => {
    expect(canManageTask(task, null, null)).toBe(false);
    expect(canManageTask(task, undefined, undefined)).toBe(false);
  });
});

describe("resolveAssignees", () => {
  const members = [
    { userId: "u1", username: "Alice" },
    { userId: "u2", username: "bob" },
  ];

  it("resolves a name from the agent to a member id", () => {
    const [task] = resolveAssignees([{ title: "Book car", assignee: "alice" }], members);
    expect(task.assignedTo).toBe("u1");
  });

  it("matches case-insensitively", () => {
    const [task] = resolveAssignees([{ title: "Book car", assignee: "BOB" }], members);
    expect(task.assignedTo).toBe("u2");
  });

  it("drops a name that is not on this trip's roster", () => {
    // The agent invents names. An assignment to a stranger is a broken row; a
    // missing assignment is an open task someone can pick up.
    const [task] = resolveAssignees([{ title: "Book car", assignee: "stranger" }], members);
    expect(task.assignedTo).toBeNull();
  });

  it("treats no assignee as open", () => {
    const [task] = resolveAssignees([{ title: "Book car" }], members);
    expect(task.assignedTo).toBeNull();
  });

  it("does not match on a prefix", () => {
    const [task] = resolveAssignees([{ title: "x", assignee: "Ali" }], members);
    expect(task.assignedTo).toBeNull();
  });
});