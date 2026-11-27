import { describe, expect, it } from "vitest";
import { latestPlanningThread, planningThreadOf } from "./initiative.js";
import {
  initiativePlanningBrief,
  initiativePlanningInstructions,
  initiativePlanningProblems,
  rewriteInInitiative,
  startInitiativePlanning,
  startPlanningInInitiative,
  type InitiativePlanningProject,
  type OpenTaskDecision,
} from "./initiative-planning.js";
import { proposePipeline, writeDefinitionOfDone, writePlan } from "./planning-changes.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { startPlanningTask } from "./task-changes.js";
import { TaskRefused } from "./task-refused.js";
import type { Task } from "./task.js";
import type { Author } from "./author.js";
import { anInitiative, aPlanningThread, aTask, BEN_ITO } from "./work.fixtures.js";
import { defaultWorkPrompts } from "./work-prompt-templates.fixtures.js";

const prompts = defaultWorkPrompts();

/** The Planner's writes from a planning Thread. */
const proposePlan = (task: Task, writing: { plan: string }, by: Author) =>
  writePlan(task, writing, by, true);
const proposeDefinitionOfDone = (task: Task, statements: readonly string[], by: Author) =>
  writeDefinitionOfDone(task, statements, by, true);

/** Whoever holds Plans in these tests; the moves are theirs, whatever their Role key. */
const THE_PLANNER: Author = { kind: "person", roleKey: "planner" };

const THREAD = "thread-1";
/** The Initiative's earlier planning Thread, auto mode off. */
const EARLIER = "thread-0";
/** A Thread on the Initiative that isn't one of its planning Threads: a shaping Thread. */
const SHAPING = "shaping-thread";
const planning = anInitiative({
  state: "active",
  planningThreads: [
    aPlanningThread({ threadId: EARLIER, autoMode: false }),
    aPlanningThread({
      threadId: THREAD,
      autoMode: true,
      openedAt: new Date("2026-10-27T09:00:00.000Z"),
    }),
  ],
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

  const AT = new Date("2026-11-12T09:00:00.000Z");

  it("keeps the new Thread, the auto mode, who asked and when on the Initiative it opens for", () => {
    const opening = { threadId: "thread-2", autoMode: false, withUser: false, by: BEN_ITO, at: AT };
    const { initiative, event } = startInitiativePlanning(
      anInitiative({ state: "active" }),
      [first],
      opening,
    );
    expect(initiative.planningThreads).toEqual([
      { threadId: "thread-2", autoMode: false, withUser: false, by: BEN_ITO, openedAt: AT },
    ]);
    expect(event).toMatchObject({ threadId: "thread-2", autoMode: false });
    expect(() => startInitiativePlanning(anInitiative(), [first], opening)).toThrow(
      InitiativeRefused,
    );
  });

  it("adds the new Thread to the planning Threads it opened, keeping the earlier ones", () => {
    const { initiative } = startInitiativePlanning(
      anInitiative({ state: "active", planningThreads: [aPlanningThread()] }),
      [first],
      { threadId: "thread-2", autoMode: false, withUser: false, by: BEN_ITO, at: AT },
    );

    expect(initiative.planningThreads.map(({ threadId }) => threadId)).toEqual([
      "thread-1",
      "thread-2",
    ]);
    expect(latestPlanningThread(initiative)?.threadId).toBe("thread-2");
  });

  it("keeps that Plan with… opened the new Thread, until a later Plan the Initiative", () => {
    const withUser = startInitiativePlanning(anInitiative({ state: "active" }), [first], {
      threadId: "thread-2",
      autoMode: false,
      withUser: true,
      by: BEN_ITO,
      at: AT,
    }).initiative;
    expect(latestPlanningThread(withUser)).toMatchObject({ threadId: "thread-2", withUser: true });

    const atOnce = startInitiativePlanning(withUser, [first], {
      threadId: "thread-3",
      autoMode: true,
      withUser: false,
      by: BEN_ITO,
      at: AT,
    }).initiative;
    expect(latestPlanningThread(atOnce)).toMatchObject({ threadId: "thread-3", withUser: false });
    expect(planningThreadOf(atOnce, "thread-2")).toMatchObject({ withUser: true });
  });
});

describe("startPlanningInInitiative", () => {
  it("moves a Backlog Task to Planning in the calling Thread and its auto mode, by the Planner", () => {
    const change = startPlanningInInitiative(planning, first, [first, second], THREAD, THE_PLANNER);
    expect(change?.task).toMatchObject({
      state: "planning",
      autoMode: true,
      initiativePlanningThreadId: THREAD,
      markedPlanned: false,
    });
    expect(change?.stateChange?.by).toEqual({ kind: "person", roleKey: "planner" });
  });

  it("records the move as whoever holds Plans, whatever their Role key", () => {
    const byTheLead: Author = { kind: "person", roleKey: "lead" };

    const change = startPlanningInInitiative(planning, first, [first, second], THREAD, byTheLead);

    expect(change?.stateChange?.by).toEqual(byTheLead);
  });

  it("refuses while a blocker inside the Initiative isn't planned yet", () => {
    expect(() =>
      startPlanningInInitiative(planning, second, [first, second], THREAD, THE_PLANNER),
    ).toThrow(
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
        startPlanningInInitiative(planning, second, [blocker, second], THREAD, THE_PLANNER)?.task
          .state,
      ).toBe("planning");
    }
    const inPlanning = { ...first, state: "planning" as const };
    expect(() =>
      startPlanningInInitiative(planning, second, [inPlanning, second], THREAD, THE_PLANNER),
    ).toThrow(TaskRefused);
  });

  it("leaves a blocker outside the Initiative out of the order", () => {
    const outside = aTask({ id: "task-x", initiativeId: undefined });
    const waiting = { ...first, blockedBy: [outside.id] };
    expect(
      startPlanningInInitiative(planning, waiting, [waiting], THREAD, THE_PLANNER)?.task.state,
    ).toBe("planning");
  });

  it("moves a Task to Planning from an earlier planning Thread, in that Thread's auto mode", () => {
    const change = startPlanningInInitiative(
      planning,
      first,
      [first, second],
      EARLIER,
      THE_PLANNER,
    );

    expect(change?.task).toMatchObject({
      state: "planning",
      autoMode: false,
      initiativePlanningThreadId: EARLIER,
    });
  });

  it("refuses a Task another planning Thread is planning, until it is marked planned there", () => {
    const plannedThere = {
      ...first,
      state: "planning" as const,
      initiativePlanningThreadId: EARLIER,
    };

    expect(() =>
      startPlanningInInitiative(planning, plannedThere, [plannedThere], THREAD, THE_PLANNER),
    ).toThrow(
      new TaskRefused([
        '"Export API" is being planned in another planning Thread: write there, or wait until it is marked planned.',
      ]),
    );
  });

  it("refuses a Task outside the Initiative, one not in Backlog, and a Thread that isn't a planning Thread", () => {
    const elsewhere = aTask({ initiativeId: "initiative-2" });
    expect(() =>
      startPlanningInInitiative(planning, elsewhere, [first], THREAD, THE_PLANNER),
    ).toThrow(new TaskRefused([`"${elsewhere.title}" isn't one of this Initiative's Tasks.`]));
    const ready = { ...first, state: "ready" as const };
    expect(() => startPlanningInInitiative(planning, ready, [ready], THREAD, THE_PLANNER)).toThrow(
      new TaskRefused(['"Export API" is in Ready; only a Task in Backlog is moved to Planning.']),
    );
    expect(() => startPlanningInInitiative(planning, first, [first], SHAPING, THE_PLANNER)).toThrow(
      new InitiativeRefused([
        "This Thread isn't one of the Initiative's planning Threads: only they plan its Tasks.",
      ]),
    );
  });

  it("changes nothing for a Task already in Planning in this Thread", () => {
    const started = { ...first, state: "planning" as const, initiativePlanningThreadId: THREAD };
    expect(
      startPlanningInInitiative(planning, started, [started], THREAD, THE_PLANNER),
    ).toBeUndefined();
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
      "asking every question that Task has in that one Decision",
      "Leave that Task, and every Task that waits for it, and keep planning the rest",
      "End your turn only when every Task left waits for an answer, or all are planned",
      "Each answer comes as a message: carry on from it",
      "Ready ones included, rewrite its parts",
      "then call mark_planned for it again",
      "A Task that has started, or one planned in its own planning Thread, is never rewritten: open a Decision on it instead",
      "you change no file",
    ]) {
      expect(initiativePlanningInstructions(prompts)).toContain(words);
    }
  });

  it("is briefed with its record, the Tasks to plan, the Projects, the Pipelines and auto mode", () => {
    const brief = initiativePlanningBrief(prompts, {
      initiative: planning,
      threadId: THREAD,
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
      '- "Export API" (Task task-a), a Feature in the Project Admin panel: waits for no Task in the Initiative. Its commit type is feat. The Pipeline Admin panel gives Features is Full (full).',
    );
    expect(brief).toContain(
      '- "Export button" (Task task-b), a Feature in the Project Admin panel: waits for "Export API" (Task task-a, Backlog). Its commit type is feat. The Pipeline Admin panel gives Features is Full (full).',
    );
    expect(brief).not.toContain("task-c), a Feature in the Project");
    expect(brief).toContain("### Admin panel (admin-panel)\n\nBase branch main");
    expect(brief).toContain("its default Pipeline is Full (full).");
    expect(brief).toContain(
      "- install (Install): `npm ci`\n- test (Test): `npm test`\n- lint (Lint): none",
    );
    expect(brief).toContain("- full: Full (Implement → Review). For most work.");
    expect(brief).toContain("## Auto mode\n\nOn:");
    expect(brief).not.toContain("## Being planned here");
    expect(brief).not.toContain("## Planning with the user");
  });

  it("names each Task's Kind, its commit type, a Bug's details and the Pipeline its Project gives its Kind", () => {
    const bug = aTask({
      id: "task-d",
      title: "Export drops rows",
      initiativeId: planning.id,
      kind: "bug",
      causedBy: first.id,
      foundInVersion: "v1.14.2",
    });
    const brief = initiativePlanningBrief(prompts, {
      initiative: planning,
      threadId: THREAD,
      waiting: [],
      record: "Initiative: Usage exports",
      tasks: [first, bug],
      projects: [
        {
          id: "admin-panel",
          name: "Admin panel",
          baseBranch: "main",
          defaultPipeline: "full",
          kindPipelines: { bug: "quick-fix" },
          installCommand: "npm ci",
          commands: [],
          ownPipelines: [],
        },
      ],
      pipelines: [
        {
          id: "full",
          name: "Full",
          description: "For most work.",
          stages: [{ name: "Implement" }],
        },
        {
          id: "quick-fix",
          name: "Quick fix",
          description: "For a fix.",
          stages: [{ name: "Fix" }],
        },
      ],
    });

    expect(brief).toContain(
      '- "Export drops rows" (Task task-d), a Bug in the Project Admin panel: waits for no Task in the Initiative. Its commit type is fix. Caused by: Export API (Task task-a, Backlog). Found in version: v1.14.2. The Pipeline Admin panel gives Bugs is Quick fix (quick-fix).',
    );
    expect(brief).toContain("write_kind");
    expect(brief).toContain("write_bug_details");
  });

  it("tells the planner to follow the user's instructions on how to plan in a Plan with… Thread", () => {
    const brief = initiativePlanningBrief(prompts, {
      initiative: anInitiative({
        state: "active",
        planningThreads: [aPlanningThread({ threadId: THREAD, withUser: true, by: BEN_ITO })],
      }),
      threadId: THREAD,
      waiting: [],
      record: "Initiative: Usage exports",
      tasks: [first],
      projects: [],
      pipelines: [],
    });

    expect(brief).toContain(
      "## Planning with the user\n\nThe user opened this Thread to plan the Initiative with you: their messages say how to plan it. Follow them where they differ from the default way your instructions give; ask in the Thread what is unclear.",
    );
    expect(brief).toContain("with Plan with….");
  });

  it("lists each Project's own Pipelines, flagged when Broken, before the office-wide ones once", () => {
    const brief = initiativePlanningBrief(prompts, {
      initiative: planning,
      threadId: THREAD,
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
            copiedFrom: { name: "Document" },
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
        "Admin panel's own Pipelines, which only its Tasks can follow:\n- spec-change: Spec change (Write). Copied from Document. For the spec. Broken before The Office updated: Changes Produce, which Document no longer has. It can't be proposed.",
        "Office-wide Pipelines:\n- full: Full (Implement → Review). For most work.",
      ].join("\n\n"),
    );
    expect(brief).not.toContain("Shop's own Pipelines");
  });

  it("names the Tasks this Thread moved to Planning and hasn't marked planned, for a fresh session", () => {
    const inThisThread = { state: "planning", initiativePlanningThreadId: THREAD } as const;
    const brief = initiativePlanningBrief(prompts, {
      initiative: planning,
      threadId: THREAD,
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
          initiativePlanningThreadId: EARLIER,
        }),
      ],
      projects: [],
      pipelines: [],
    });
    const start = brief.indexOf("## Being planned here");
    const section = brief.slice(start, brief.indexOf("\n## ", start + 1));
    expect(section).toContain('- "Export API" (Task task-a)');
    expect(section).toContain("(Task task-c)");
    expect(section).not.toContain("task-b");
    expect(section).not.toContain("task-d");
  });

  it("lists the other planning Threads with their dates and the Tasks each owns, read with read_threads", () => {
    const brief = (threadId: string) =>
      initiativePlanningBrief(prompts, {
        initiative: planning,
        threadId,
        waiting: [],
        record: "Initiative: Usage exports",
        tasks: [
          { ...first, state: "planning", initiativePlanningThreadId: EARLIER, markedPlanned: true },
          { ...second, state: "ready", initiativePlanningThreadId: EARLIER },
        ],
        projects: [],
        pipelines: [],
      });

    const fromTheLatest = brief(THREAD);
    expect(fromTheLatest).toContain("## The other planning Threads");
    expect(fromTheLatest).toContain(
      `read it with read_threads, giving initiativeId ${planning.id} and a range from when it was opened, instead of researching again.`,
    );
    expect(fromTheLatest).toContain(
      '- Thread thread-0, opened 2026-10-26T09:00:00.000Z: its Tasks are "Export API" (Task task-a, Planning, marked planned), "Export button" (Task task-b, Ready).',
    );
    expect(brief(EARLIER)).toContain(
      "- Thread thread-1, opened 2026-10-27T09:00:00.000Z, the latest: it owns no Task.",
    );
    const alone = anInitiative({ state: "active", planningThreads: [aPlanningThread()] });
    expect(
      initiativePlanningBrief(prompts, {
        initiative: alone,
        threadId: "thread-1",
        waiting: [],
        record: "",
        tasks: [first],
        projects: [],
        pipelines: [],
      }),
    ).not.toContain("## The other planning Threads");
  });

  it("is briefed with the calling Thread's auto mode and who opened it, not the latest's", () => {
    const fromTheEarlier = initiativePlanningBrief(prompts, {
      initiative: planning,
      threadId: EARLIER,
      waiting: [],
      record: "Initiative: Usage exports",
      tasks: [first],
      projects: [],
      pipelines: [],
    });

    expect(fromTheEarlier).toContain("## Auto mode\n\nOff:");
    expect(fromTheEarlier).toContain("This planning Thread was opened by the user Ann Lee");
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
  return proposePlan(task, { plan: "A Plan the answer changed." }, THE_PLANNER);
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

    const change = rewriteInInitiative(planning, ready, THREAD, THE_PLANNER, rewritten);

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

  it("records the move back to Planning as whoever holds Plans, whatever their Role key", () => {
    const byTheLead: Author = { kind: "person", roleKey: "lead" };
    const ready = aTask({ ...first, state: "ready", markedPlanned: true });

    const change = rewriteInInitiative(planning, ready, THREAD, byTheLead, (task) =>
      proposePlan(task, { plan: "A Plan the lead rewrote." }, byTheLead),
    );

    expect(change?.stateChange).toMatchObject({ from: "ready", to: "planning", by: byTheLead });
  });

  it("plans a Task marked planned in an earlier planning Thread in this one, moving nothing", () => {
    const earlier = aTask({
      ...first,
      state: "planning",
      initiativePlanningThreadId: EARLIER,
      markedPlanned: true,
    });

    const change = rewriteInInitiative(planning, earlier, THREAD, THE_PLANNER, rewritten);

    expect(change?.task).toMatchObject({
      initiativePlanningThreadId: THREAD,
      markedPlanned: false,
    });
    expect(change?.stateChange).toBeUndefined();
    expect(change?.event.moves).toEqual([]);
  });

  it("rewrites from an earlier planning Thread too, which then owns the Task in its auto mode", () => {
    const markedInTheLatest = aTask({
      ...first,
      state: "planning",
      initiativePlanningThreadId: THREAD,
      markedPlanned: true,
      autoMode: true,
    });

    const change = rewriteInInitiative(
      planning,
      markedInTheLatest,
      EARLIER,
      THE_PLANNER,
      rewritten,
    );

    expect(change?.task).toMatchObject({
      initiativePlanningThreadId: EARLIER,
      autoMode: false,
      markedPlanned: false,
    });
    const ready = aTask({ ...first, state: "ready", markedPlanned: true });
    expect(
      rewriteInInitiative(planning, ready, EARLIER, THE_PLANNER, rewritten)?.task,
    ).toMatchObject({ state: "planning", initiativePlanningThreadId: EARLIER, autoMode: false });
  });

  it("refuses a write to a Task another planning Thread is planning, not yet marked planned", () => {
    const plannedThere = aTask({ ...first, state: "planning", initiativePlanningThreadId: THREAD });

    expect(() =>
      rewriteInInitiative(planning, plannedThere, EARLIER, THE_PLANNER, rewritten),
    ).toThrow(
      new TaskRefused([
        '"Export API" is being planned in another planning Thread: write there, or wait until it is marked planned.',
      ]),
    );
  });

  it("moves nothing when the write changes nothing", () => {
    const ready = aTask({ ...first, state: "ready", plan: "A Plan the answer changed." });
    expect(rewriteInInitiative(planning, ready, THREAD, THE_PLANNER, rewritten)).toBeUndefined();
  });

  it("never rewrites a started, Dropped or own-Thread Task, nor from a Thread that isn't a planning Thread", () => {
    const decisionInstead =
      "it has started and is never rewritten: open a Decision on it saying what changed and what you recommend.";
    for (const state of ["in-progress", "waiting-on-you", "paused", "done", "dropped"] as const) {
      const refused = () =>
        rewriteInInitiative(planning, aTask({ ...first, state }), THREAD, THE_PLANNER, rewritten);
      expect(refused).toThrow(TaskRefused);
      expect(refused).toThrow(decisionInstead);
    }
    const ownThread = aTask({ ...first, state: "planning", initiativePlanningThreadId: undefined });
    expect(() => rewriteInInitiative(planning, ownThread, THREAD, THE_PLANNER, rewritten)).toThrow(
      `"Export API" is being planned in its own planning Thread and is never rewritten from here: open a Decision on it saying what changed and what you recommend.`,
    );
    const ready = aTask({ ...first, state: "ready" });
    expect(() => rewriteInInitiative(planning, ready, SHAPING, THE_PLANNER, rewritten)).toThrow(
      InitiativeRefused,
    );
  });
});

describe("the planning Brief's Decisions", () => {
  it("lists the Decisions open in this Thread with their Tasks, for a fresh session", () => {
    const brief = initiativePlanningBrief(prompts, {
      initiative: planning,
      threadId: THREAD,
      waiting: [{ taskId: first.id, question: "Which format?" }],
      record: "Initiative: Usage exports",
      tasks: [first, second],
      projects: [],
      pipelines: [],
    });

    expect(brief).toContain(
      `## Waiting for an answer\n\nThis Thread opened these Decisions, which still wait on the user: don't ask them again, and leave each Task, and the Tasks that wait for it, until its answer comes as a message.\n\n- "Export API" (Task ${first.id}): "Which format?"`,
    );
    expect(
      initiativePlanningBrief(prompts, {
        initiative: planning,
        threadId: THREAD,
        waiting: [],
        record: "",
        tasks: [first],
        projects: [],
        pipelines: [],
      }),
    ).not.toContain("## Waiting for an answer");
  });

  it("leaves the Decision open on the Initiative as a whole to the Brief's own section of it", () => {
    const brief = (waiting: readonly OpenTaskDecision[]) =>
      initiativePlanningBrief(prompts, {
        initiative: planning,
        threadId: THREAD,
        waiting,
        record: "Initiative: Usage exports",
        tasks: [first, second],
        projects: [],
        pipelines: [],
      });
    const onTheInitiative = { taskId: undefined, question: "Ship both Projects together?" };

    const beside = brief([{ taskId: first.id, question: "Which format?" }, onTheInitiative]);
    expect(beside).toContain(`- "Export API" (Task ${first.id}): "Which format?"`);
    expect(beside).not.toContain("Ship both Projects together?");
    expect(brief([onTheInitiative])).not.toContain("## Waiting for an answer");
  });

  it("tells the planner to open one Decision on the Initiative as a whole leaving taskId out", () => {
    expect(initiativePlanningInstructions(prompts)).toContain(
      "When a choice is about the Initiative as a whole rather than one Task, open one Decision leaving taskId out",
    );
  });
});

describe("writing a part of a Task marked planned", () => {
  const marked = aTask({ ...first, state: "planning", markedPlanned: true });

  it("takes the mark back in every Thread, so mark_planned accepts it again", () => {
    expect(proposePlan(marked, { plan: "Rewritten." }, THE_PLANNER)?.task.markedPlanned).toBe(
      false,
    );
    expect(proposeDefinitionOfDone(marked, ["It exports."], THE_PLANNER)?.task.markedPlanned).toBe(
      false,
    );
    expect(
      proposePipeline(marked, { pipelineId: "full", reason: "It changes the API." }, THE_PLANNER)
        ?.task.markedPlanned,
    ).toBe(false);
  });
});
