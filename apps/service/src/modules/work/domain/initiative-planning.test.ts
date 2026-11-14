import { describe, expect, it } from "vitest";
import {
  INITIATIVE_PLANNING_INSTRUCTIONS,
  initiativePlanningBrief,
  initiativePlanningProblems,
  rewriteInInitiative,
  startInitiativePlanning,
  startPlanningInInitiative,
  type InitiativePlanningProject,
} from "./initiative-planning.js";
import { proposeDefinitionOfDone, proposePipeline, proposePlan } from "./planning-changes.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { startPlanningTask } from "./task-changes.js";
import { TaskRefused } from "./task-refused.js";
import type { Task } from "./task.js";
import { anInitiative, aTask, BEN_ITO } from "./work.fixtures.js";

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

  it("keeps the new Thread, the auto mode and who asked on the Initiative it opens for", () => {
    const opening = { threadId: "thread-2", autoMode: false, by: BEN_ITO };
    const { initiative, event } = startInitiativePlanning(
      anInitiative({ state: "active" }),
      [first],
      opening,
    );
    expect(initiative).toMatchObject({
      planningThreadId: "thread-2",
      planningAutoMode: false,
      planningStartedBy: BEN_ITO,
    });
    expect(event).toMatchObject({ threadId: "thread-2", autoMode: false });
    expect(() => startInitiativePlanning(anInitiative(), [first], opening)).toThrow(
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
  it("plans in the Task's own Thread, moved by the user who asked, not marked planned whatever it was", () => {
    const change = startPlanningTask(
      aTask({ markedPlanned: true, initiativePlanningThreadId: THREAD }),
      false,
      { kind: "own", by: BEN_ITO },
    );
    expect(change?.task).toMatchObject({
      state: "planning",
      initiativePlanningThreadId: undefined,
      markedPlanned: false,
      hasPlanningThread: true,
    });
    expect(change?.stateChange?.by).toEqual(BEN_ITO);
  });
});

describe("the Initiative's planning Thread", () => {
  it("tells the Planner the order, the subagents, the tools, how to ask and how to rewrite", () => {
    for (const words of [
      "dependency order",
      "blockers outside the Initiative don't set the order",
      "start_planning",
      "If you have subagents",
      "in parallel",
      "Without subagents, plan the Tasks one after another yourself",
      "mark_planned",
      "open a Decision on it with open_decision, giving its taskId",
      "Leave that Task, and every Task that waits for it, and keep planning the rest",
      "End your turn only when every Task left waits for an answer, or all are planned",
      "Each answer comes as a message: carry on from it",
      "Ready ones included, rewrite its parts",
      "then call mark_planned for it again",
      "A Task that has started, or one planned in its own planning Thread, is never rewritten: open a Decision on it instead",
      "you change no file",
    ]) {
      expect(INITIATIVE_PLANNING_INSTRUCTIONS).toContain(words);
    }
  });

  it("is briefed with its record, the Tasks to plan, the Projects, the Pipelines and auto mode", () => {
    const brief = initiativePlanningBrief({
      initiative: planning,
      waiting: [],
      record: "Initiative: Usage exports",
      tasks: [first, second, aTask({ id: "task-c", state: "done", initiativeId: planning.id })],
      projects: [
        {
          id: "admin-panel",
          name: "Admin panel",
          baseBranch: "main",
          defaultPipeline: "full",
          installCommand: "npm ci",
          commands: [
            { key: "test", name: "Test", commandLine: "npm test" },
            { key: "lint", name: "Lint", commandLine: "" },
          ],
          ownPipelines: [],
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
    expect(brief).toContain("its default Pipeline is Full (full).");
    expect(brief).toContain(
      "- install (Install): `npm ci`\n- test (Test): `npm test`\n- lint (Lint): none",
    );
    expect(brief).toContain("- full: Full (Implement → Review). For most work.");
    expect(brief).toContain("## Auto mode\n\nOn:");
    expect(brief).not.toContain("## Being planned here");
  });

  it("lists each Project's own Pipelines, flagged when Broken, before the office-wide ones once", () => {
    const brief = initiativePlanningBrief({
      initiative: planning,
      waiting: [],
      record: "Initiative: Usage exports",
      tasks: [first, second],
      projects: [
        planningProject("admin-panel", "Admin panel", [
          {
            id: "spec-change",
            name: "Spec change",
            description: "For the spec.",
            stages: [{ name: "Write" }],
            projectId: "admin-panel",
            basePipeline: { id: "document", name: "Document" },
            broken: ["Changes Produce, which Document no longer has."],
          },
        ]),
        planningProject("shop", "Shop", []),
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

    expect(brief).toContain(
      [
        "Admin panel's own Pipelines, which only its Tasks can follow:\n- spec-change: Spec change (Write). Built from Document. For the spec. Broken: Changes Produce, which Document no longer has. It can't be proposed.",
        "Office-wide Pipelines:\n- full: Full (Implement → Review). For most work.",
      ].join("\n\n"),
    );
    expect(brief).not.toContain("Shop's own Pipelines");
  });

  it("names the Tasks this Thread moved to Planning and hasn't marked planned, for a fresh session", () => {
    const inThisThread = { state: "planning", initiativePlanningThreadId: THREAD } as const;
    const brief = initiativePlanningBrief({
      initiative: planning,
      waiting: [],
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

/** A Project an Initiative's planning Brief names, with its own Pipelines. */
function planningProject(
  id: string,
  name: string,
  ownPipelines: InitiativePlanningProject["ownPipelines"],
): InitiativePlanningProject {
  return {
    id,
    name,
    baseBranch: "main",
    defaultPipeline: "full",
    installCommand: "",
    commands: [],
    ownPipelines,
  };
}

/** The Planner's write of a Plan an answer changed. */
function rewritten(task: Task) {
  return proposePlan(task, { plan: "A Plan the answer changed." });
}

describe("rewriteInInitiative", () => {
  const byThePlanner = { kind: "person", roleKey: "planner" };

  it("takes a Ready Task back to Planning in this Thread in one move, with no stop in Backlog", () => {
    const ready = aTask({
      ...first,
      state: "ready",
      plan: "The Plan before the answer.",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
      markedPlanned: true,
      autoMode: false,
    });

    const change = rewriteInInitiative(planning, ready, THREAD, rewritten);

    expect(change?.task).toMatchObject({
      state: "planning",
      initiativePlanningThreadId: THREAD,
      autoMode: true,
      markedPlanned: false,
      plan: "A Plan the answer changed.",
      planConfirmed: false,
      definitionOfDoneConfirmed: true,
      hasPlanningThread: true,
    });
    expect(change?.stateChange).toEqual({
      from: "ready",
      to: "planning",
      at: expect.any(Date),
      by: byThePlanner,
    });
    expect(change?.event.moves.map(({ from, to }) => [from, to])).toEqual([["ready", "planning"]]);
  });

  it("plans a Task marked planned in an earlier planning Thread in this one, moving nothing", () => {
    const earlier = aTask({
      ...first,
      state: "planning",
      initiativePlanningThreadId: "thread-0",
      markedPlanned: true,
    });

    const change = rewriteInInitiative(planning, earlier, THREAD, rewritten);

    expect(change?.task).toMatchObject({
      initiativePlanningThreadId: THREAD,
      markedPlanned: false,
    });
    expect(change?.stateChange).toBeUndefined();
    expect(change?.event.moves).toEqual([]);
  });

  it("moves nothing when the write changes nothing", () => {
    const ready = aTask({ ...first, state: "ready", plan: "A Plan the answer changed." });
    expect(rewriteInInitiative(planning, ready, THREAD, rewritten)).toBeUndefined();
  });

  it("never rewrites a started, Dropped or own-Thread Task, nor from an earlier Thread", () => {
    const decisionInstead =
      "it has started and is never rewritten: open a Decision on it saying what changed and what you recommend.";
    for (const state of ["in-progress", "waiting-on-you", "paused", "done", "dropped"] as const) {
      const refused = () =>
        rewriteInInitiative(planning, aTask({ ...first, state }), THREAD, rewritten);
      expect(refused).toThrow(TaskRefused);
      expect(refused).toThrow(decisionInstead);
    }
    const ownThread = aTask({ ...first, state: "planning", initiativePlanningThreadId: undefined });
    expect(() => rewriteInInitiative(planning, ownThread, THREAD, rewritten)).toThrow(
      `"Export API" is being planned in its own planning Thread and is never rewritten from here: open a Decision on it saying what changed and what you recommend.`,
    );
    const ready = aTask({ ...first, state: "ready" });
    expect(() => rewriteInInitiative(planning, ready, "thread-0", rewritten)).toThrow(
      InitiativeRefused,
    );
  });
});

describe("the planning Brief's Decisions", () => {
  it("lists the Decisions open in this Thread with their Tasks, for a fresh session", () => {
    const brief = initiativePlanningBrief({
      initiative: planning,
      waiting: [{ taskId: first.id, question: "Which format?" }],
      record: "Initiative: Usage exports",
      tasks: [first, second],
      projects: [],
      pipelines: [],
    });

    expect(brief).toContain(
      `## Waiting for an answer\n\nThis Thread opened these Decisions, which still wait on the user: leave each Task, and the Tasks that wait for it, until its answer comes as a message.\n\n- "Export API" (Task ${first.id}): "Which format?"`,
    );
    expect(
      initiativePlanningBrief({
        initiative: planning,
        waiting: [],
        record: "",
        tasks: [first],
        projects: [],
        pipelines: [],
      }),
    ).not.toContain("## Waiting for an answer");
  });
});

describe("writing a part of a Task marked planned", () => {
  const marked = aTask({ ...first, state: "planning", markedPlanned: true });

  it("takes the mark back in every Thread, so mark_planned accepts it again", () => {
    expect(proposePlan(marked, { plan: "Rewritten." })?.task.markedPlanned).toBe(false);
    expect(proposeDefinitionOfDone(marked, ["It exports."])?.task.markedPlanned).toBe(false);
    expect(
      proposePipeline(marked, { pipelineId: "full", reason: "It changes the API." })?.task
        .markedPlanned,
    ).toBe(false);
  });
});
