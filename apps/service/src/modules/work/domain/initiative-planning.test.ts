import { describe, expect, it } from "vitest";
import {
  INITIATIVE_PLANNING_INSTRUCTIONS,
  initiativePlanningBrief,
  initiativePlanningProblems,
  startInitiativePlanning,
  startPlanningInInitiative,
} from "./initiative-planning.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { startPlanningTask } from "./task-changes.js";
import { TaskRefused } from "./task-refused.js";
import { anInitiative, aTask } from "./work.fixtures.js";

const THREAD = "thread-1";
const planning = anInitiative({
  state: "active",
  planningThreadId: THREAD,
  planningAutoMode: true,
});
const first = aTask({ id: "task-a", title: "Export API", initiativeId: planning.id });
const second = aTask({
  id: "task-b",
  title: "Export button",
  initiativeId: planning.id,
  blockedBy: [first.id],
});

describe("initiativePlanningProblems", () => {
  it("allows an active Initiative with a Task in Backlog", () => {
    expect(initiativePlanningProblems(planning, [first, second])).toEqual([]);
  });

  it("refuses an Initiative that isn't active", () => {
    expect(initiativePlanningProblems(anInitiative({ state: "shaping" }), [first])).toEqual([
      "Only an active Initiative is planned; this one is being shaped: confirm it first.",
    ]);
    expect(initiativePlanningProblems(anInitiative({ state: "done" }), [first])).toEqual([
      "Only an active Initiative is planned; this one is done.",
    ]);
  });

  it("refuses one with no Task in Backlog", () => {
    expect(initiativePlanningProblems(planning, [{ ...first, state: "ready" }])).toEqual([
      "None of the Initiative's Tasks is in Backlog: nothing is left to plan.",
    ]);
  });

  it("refuses while a Task is still being planned in an earlier planning Thread, naming both", () => {
    const stillPlanning = {
      ...first,
      state: "planning" as const,
      initiativePlanningThreadId: "thread-0",
    };
    expect(initiativePlanningProblems(planning, [stillPlanning, second])).toEqual([
      '"Export API" is still being planned in the earlier planning Thread (Thread thread-0). Wait until it is marked planned there, or confirm it yourself.',
    ]);
    const marked = { ...stillPlanning, markedPlanned: true };
    expect(initiativePlanningProblems(planning, [marked, second])).toEqual([]);
  });

  it("keeps the new Thread and the auto mode on the Initiative it opens for", () => {
    const { initiative, event } = startInitiativePlanning(
      anInitiative({ state: "active" }),
      [first],
      "thread-2",
      false,
    );
    expect(initiative).toMatchObject({ planningThreadId: "thread-2", planningAutoMode: false });
    expect(event).toMatchObject({ threadId: "thread-2", autoMode: false });
    expect(() => startInitiativePlanning(anInitiative(), [first], "thread-2", false)).toThrow(
      InitiativeRefused,
    );
  });
});

describe("startPlanningInInitiative", () => {
  it("moves a Backlog Task to Planning in the Initiative's Thread and auto mode, by the Planner", () => {
    const change = startPlanningInInitiative(planning, first, [first, second], THREAD);
    expect(change?.task).toMatchObject({
      state: "planning",
      autoMode: true,
      initiativePlanningThreadId: THREAD,
      markedPlanned: false,
    });
    expect(change?.stateChange?.by).toEqual({ kind: "person", roleKey: "planner" });
  });

  it("refuses while a blocker inside the Initiative isn't planned yet", () => {
    expect(() => startPlanningInInitiative(planning, second, [first, second], THREAD)).toThrow(
      new TaskRefused([
        '"Export button" waits for "Export API" (Task task-a), which isn\'t planned yet: plan it first.',
      ]),
    );
  });

  it("lets a Task go once each blocker is marked planned, Ready or beyond, or Dropped", () => {
    for (const blocker of [
      { ...first, state: "planning" as const, markedPlanned: true },
      { ...first, state: "ready" as const },
      { ...first, state: "done" as const },
      { ...first, state: "dropped" as const },
    ]) {
      expect(
        startPlanningInInitiative(planning, second, [blocker, second], THREAD)?.task.state,
      ).toBe("planning");
    }
    const inPlanning = { ...first, state: "planning" as const };
    expect(() => startPlanningInInitiative(planning, second, [inPlanning, second], THREAD)).toThrow(
      TaskRefused,
    );
  });

  it("leaves a blocker outside the Initiative out of the order", () => {
    const outside = aTask({ id: "task-x", initiativeId: undefined });
    const waiting = { ...first, blockedBy: [outside.id] };
    expect(startPlanningInInitiative(planning, waiting, [waiting], THREAD)?.task.state).toBe(
      "planning",
    );
  });

  it("refuses a Task outside the Initiative, one not in Backlog, and an earlier Thread", () => {
    const elsewhere = aTask({ initiativeId: "initiative-2" });
    expect(() => startPlanningInInitiative(planning, elsewhere, [first], THREAD)).toThrow(
      new TaskRefused([`"${elsewhere.title}" isn't one of this Initiative's Tasks.`]),
    );
    const ready = { ...first, state: "ready" as const };
    expect(() => startPlanningInInitiative(planning, ready, [ready], THREAD)).toThrow(
      new TaskRefused(['"Export API" is in Ready; only a Task in Backlog is moved to Planning.']),
    );
    expect(() => startPlanningInInitiative(planning, first, [first], "thread-0")).toThrow(
      InitiativeRefused,
    );
  });

  it("changes nothing for a Task already in Planning in this Thread", () => {
    const started = { ...first, state: "planning" as const, initiativePlanningThreadId: THREAD };
    expect(startPlanningInInitiative(planning, started, [started], THREAD)).toBeUndefined();
  });
});

describe("startPlanningTask", () => {
  it("plans in the Task's own Thread by default, not marked planned whatever it was", () => {
    const change = startPlanningTask(
      aTask({ markedPlanned: true, initiativePlanningThreadId: THREAD }),
      false,
    );
    expect(change?.task).toMatchObject({
      state: "planning",
      initiativePlanningThreadId: undefined,
      markedPlanned: false,
    });
    expect(change?.stateChange?.by).toEqual({ kind: "user" });
  });
});

describe("the Initiative's planning Thread", () => {
  it("tells the Planner the order, the subagents, the tools and which Tasks to leave", () => {
    for (const words of [
      "dependency order",
      "blockers outside the Initiative don't set the order",
      "start_planning",
      "If you have subagents",
      "in parallel",
      "Without subagents, plan the Tasks one after another yourself",
      "mark_planned",
      "leave every Task that waits for it",
      "which you left and why",
      "you change no file",
    ]) {
      expect(INITIATIVE_PLANNING_INSTRUCTIONS).toContain(words);
    }
  });

  it("is briefed with its record, the Tasks to plan, the Projects, the Pipelines and auto mode", () => {
    const brief = initiativePlanningBrief({
      initiative: planning,
      record: "Initiative: Usage exports",
      tasks: [first, second, aTask({ id: "task-c", state: "done", initiativeId: planning.id })],
      projects: [
        {
          id: "admin-panel",
          name: "Admin panel",
          baseBranch: "main",
          commands: { test: "npm test", lint: "" },
        },
      ],
      pipelines: [
        {
          id: "full",
          name: "Full",
          description: "For most work.",
          stages: [{ name: "Implement" }, { name: "Review" }],
        },
      ],
    });
    expect(brief).toContain("Initiative: Usage exports");
    expect(brief).toContain(
      '- "Export API" (Task task-a), in the Project Admin panel: waits for no Task in the Initiative.',
    );
    expect(brief).toContain(
      '- "Export button" (Task task-b), in the Project Admin panel: waits for "Export API" (Task task-a, Backlog).',
    );
    expect(brief).not.toContain("task-c), in the Project");
    expect(brief).toContain("### Admin panel (admin-panel)\n\nBase branch main");
    expect(brief).toContain("- test: `npm test`\n- lint: none");
    expect(brief).toContain("- full: Full (Implement → Review). For most work.");
    expect(brief).toContain("## Auto mode\n\nOn:");
    expect(brief).not.toContain("## Being planned here");
  });

  it("names the Tasks this Thread moved to Planning and hasn't marked planned, for a fresh session", () => {
    const inThisThread = { state: "planning", initiativePlanningThreadId: THREAD } as const;
    const brief = initiativePlanningBrief({
      initiative: planning,
      record: "Initiative: Usage exports",
      tasks: [
        { ...first, ...inThisThread },
        { ...second, ...inThisThread, markedPlanned: true },
        aTask({ id: "task-c", initiativeId: planning.id, ...inThisThread }),
        aTask({
          id: "task-d",
          initiativeId: planning.id,
          state: "planning",
          initiativePlanningThreadId: "an-earlier-thread",
        }),
      ],
      projects: [],
      pipelines: [],
    });
    const section = brief.slice(brief.indexOf("## Being planned here"));
    expect(section).toContain('- "Export API" (Task task-a)');
    expect(section).toContain("(Task task-c)");
    expect(section).not.toContain("task-b");
    expect(section).not.toContain("task-d");
  });
});
