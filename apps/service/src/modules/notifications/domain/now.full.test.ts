import { describe, expect, it } from "vitest";
import {
  currentStageOf,
  nowOf,
  sinceYouLeftOf,
  waitingGateOf,
  type NeedsYouItem,
  type NowParts,
  type OffBoardTaskOnNow,
  type OfficeInitiative,
  type OfficeTask,
  type OpenProposal,
  type StageOfTask,
  type TaskResume,
} from "./now.js";
import { NO_TOKENS } from "./office-day.js";

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 27, 9, minute));

const TASK: OfficeTask = {
  id: "t1",
  title: "Add a filter",
  projectId: "p1",
  state: "in-progress",
  pausedBy: undefined,
  resumesAt: undefined,
};

function stage(
  key: string,
  kind: string,
  state: string,
  runs: StageOfTask["runs"],
  role?: string,
): StageOfTask {
  return { stage: { key, name: `${key} Stage`, kind, ...(role && { role }) }, state, runs };
}

function idOf(item: NeedsYouItem): string {
  return "decisionId" in item ? item.decisionId : item.kind;
}

const PARTS: NowParts = {
  started: [],
  openDecisions: [],
  queued: [],
  tasks: [],
  offBoardTasks: [],
  initiatives: [],
  initiativeTasks: new Map(),
  shaper: undefined,
  tokensToday: NO_TOKENS,
  officeWideLimit: 3,
  usageWindows: [],
  fireAlarm: { on: false },
  resumes: new Map(),
  standInChoices: [],
  openProposals: [],
  pullRequests: [],
  skillUpdates: [],
  officeUpdate: undefined,
  shapingReplies: [],
};

describe("currentStageOf", () => {
  it("is the Stage with the latest run, since that run started", () => {
    const stages = [
      stage("build", "agent", "done", [{ startedAt: at(1), endedAt: at(5) }], "developer"),
      stage("test", "script", "failed", [{ startedAt: at(5), endedAt: at(6) }]),
      stage("build-again", "agent", "running", [{ startedAt: at(7), endedAt: undefined }], "dev"),
    ];

    expect(currentStageOf(stages)).toEqual({
      key: "build-again",
      name: "build-again Stage",
      role: "dev",
      since: at(7),
    });
  });

  it("has no person for a Script Stage, and is undefined before the first run", () => {
    expect(
      currentStageOf([
        stage("test", "script", "running", [{ startedAt: at(1), endedAt: undefined }]),
      ]),
    ).toMatchObject({ key: "test", role: undefined });
    expect(currentStageOf([stage("build", "agent", "pending", [], "developer")])).toBeUndefined();
  });
});

describe("waitingGateOf", () => {
  it("is the Gate waiting on the user, since its run ended", () => {
    const stages = [
      stage("build", "agent", "done", [{ startedAt: at(1), endedAt: at(4) }], "developer"),
      stage("look", "gate", "waiting-on-you", [{ startedAt: at(4), endedAt: at(4) }]),
    ];

    expect(waitingGateOf(TASK, stages)).toEqual({
      kind: "gate",
      taskId: "t1",
      projectId: "p1",
      stageKey: "look",
      waitingSince: at(4),
    });
  });

  it("is undefined once the user acted at the Gate", () => {
    const stages = [stage("look", "gate", "done", [{ startedAt: at(4), endedAt: at(4) }])];

    expect(waitingGateOf(TASK, stages)).toBeUndefined();
  });
});

describe("nowOf", () => {
  it("lists Decisions and Gates in Needs you, oldest first", () => {
    const now = nowOf({
      ...PARTS,
      started: [
        {
          task: { ...TASK, state: "waiting-on-you" },
          stages: [stage("look", "gate", "waiting-on-you", [{ startedAt: at(3), endedAt: at(3) }])],
        },
      ],
      openDecisions: [
        { id: "d2", threadId: "th", taskId: "t2", askedAt: at(9) },
        { id: "d1", threadId: "th", taskId: "t3", askedAt: at(1) },
      ],
      tasks: [TASK, { ...TASK, id: "t2" }, { ...TASK, id: "t3" }],
    });

    expect(now.needsYou.map((item) => (item.kind === "gate" ? item.stageKey : idOf(item)))).toEqual(
      ["d1", "look", "d2"],
    );
  });

  it("lists every Stage waiting for a Stand-in Engine as one item, since the oldest, with their Projects", () => {
    const choice = {
      resetsAt: at(50).toISOString(),
      standInNow: { engineName: "Spare" },
      asked: { engineName: "Spare" },
    };
    const now = nowOf({
      ...PARTS,
      openDecisions: [{ id: "d1", threadId: "th", taskId: "t1", askedAt: at(4) }],
      tasks: [TASK],
      standInChoices: [
        { ...choice, taskId: "t2", projectId: "p2", waitingSince: at(6) },
        { ...choice, taskId: "t3", projectId: "p1", waitingSince: at(2) },
        { ...choice, taskId: "t4", projectId: "p2", waitingSince: at(8) },
      ],
    });

    expect(now.needsYou).toEqual([
      { kind: "stand-in-choice", projectIds: ["p2", "p1"], waitingSince: at(2), count: 3 },
      { kind: "decision", decisionId: "d1", taskId: "t1", projectId: "p1", waitingSince: at(4) },
    ]);
  });

  it("lists no Stand-in Engine item while no Stage waits for the choice", () => {
    expect(nowOf(PARTS).needsYou).toEqual([]);
  });

  it("marks each Decision with its Task's Project, leaving out one on a Task Work no longer knows", () => {
    const now = nowOf({
      ...PARTS,
      openDecisions: [
        { id: "d1", threadId: "th", taskId: "t2", askedAt: at(1) },
        { id: "d2", threadId: "th", taskId: "gone", askedAt: at(2) },
      ],
      tasks: [{ ...TASK, id: "t2", projectId: "p2" }],
    });

    expect(now.needsYou).toEqual([
      { kind: "decision", decisionId: "d1", taskId: "t2", projectId: "p2", waitingSince: at(1) },
    ]);
  });

  it("lists a Decision on no Task in an Initiative's Thread with the Projects the Initiative spans", () => {
    const initiative = { id: "i1", name: "Billing", state: "active", createdAt: at(0) };
    const now = nowOf({
      ...PARTS,
      openDecisions: [
        { id: "d1", threadId: "th1", initiativeId: "i1", askedAt: at(5) },
        { id: "d2", threadId: "th2", taskId: "t2", askedAt: at(2) },
      ],
      tasks: [{ ...TASK, id: "t2", projectId: "p2" }],
      initiatives: [initiative],
      initiativeTasks: new Map([
        [
          "i1",
          [
            { projectId: "p1", state: "in-progress" },
            { projectId: "p3", state: "dropped" },
            { projectId: "p2", state: "draft" },
            { projectId: "p1", state: "draft" },
          ],
        ],
      ]),
    });

    expect(now.needsYou).toEqual([
      { kind: "decision", decisionId: "d2", taskId: "t2", projectId: "p2", waitingSince: at(2) },
      {
        kind: "initiative-decision",
        decisionId: "d1",
        initiativeId: "i1",
        threadId: "th1",
        projectIds: ["p1", "p2"],
        waitingSince: at(5),
      },
    ]);
  });

  it("leaves out a Decision on an Initiative Work no longer knows or that ended", () => {
    const now = nowOf({
      ...PARTS,
      openDecisions: [
        { id: "d1", threadId: "th1", initiativeId: "gone", askedAt: at(1) },
        { id: "d2", threadId: "th2", initiativeId: "done", askedAt: at(2) },
        { id: "d3", threadId: "th3", initiativeId: "dropped", askedAt: at(3) },
        { id: "d4", threadId: "th4", initiativeId: "shaping", askedAt: at(4) },
      ],
      initiatives: ["done", "dropped", "shaping"].map((state) => ({
        id: state,
        name: state,
        state,
        createdAt: at(0),
      })),
    });

    expect(now.needsYou).toEqual([
      expect.objectContaining({ kind: "initiative-decision", decisionId: "d4", projectIds: [] }),
    ]);
  });

  it("counts every started Task against the desks, and runs each with its Stage", () => {
    const paused = { ...TASK, id: "t2", state: "paused" };
    const now = nowOf({
      ...PARTS,
      started: [
        {
          task: TASK,
          stages: [
            stage(
              "build",
              "agent",
              "running",
              [{ startedAt: at(2), endedAt: undefined }],
              "developer",
            ),
          ],
        },
        { task: paused, stages: undefined },
      ],
      officeWideLimit: 3,
    });

    expect(now.desks).toEqual({ inUse: 2, limit: 3 });
    expect(now.running).toEqual([
      {
        taskId: "t1",
        title: "Add a filter",
        projectId: "p1",
        state: "in-progress",
        stage: { key: "build", name: "build Stage", role: "developer", since: at(2) },
      },
      { taskId: "t2", title: "Add a filter", projectId: "p1", state: "paused", stage: undefined },
    ]);
  });

  it("shows each Task's latest outcome since the user left, latest first", () => {
    const other = { ...TASK, id: "t2", title: "Fix the header", state: "done" };
    const since = sinceYouLeftOf(
      at(0),
      [
        { taskId: "t1", outcome: "paused", occurredAt: at(2) },
        { taskId: "t2", outcome: "done", occurredAt: at(3) },
        { taskId: "t1", outcome: "failed", occurredAt: at(5) },
        { taskId: "gone", outcome: "done", occurredAt: at(6) },
      ],
      [TASK, other],
    );

    expect(since.leftAt).toEqual(at(0));
    expect(since.finished).toEqual([
      {
        taskId: "t1",
        title: "Add a filter",
        projectId: "p1",
        outcome: "failed",
        occurredAt: at(5),
      },
      {
        taskId: "t2",
        title: "Fix the header",
        projectId: "p1",
        outcome: "done",
        occurredAt: at(3),
      },
    ]);
  });

  it("shows the queue in its order, each Task with its place and reasons", () => {
    const first = { ...TASK, id: "t2", title: "Fix the header", state: "ready" };
    const second = { ...TASK, id: "t3", projectId: "p2", state: "ready" };
    const waits = ["The Office-wide limit is reached: all 3 desks are in use."];
    const now = nowOf({
      ...PARTS,
      tasks: [TASK, second, first],
      queued: [
        { taskId: "t2", reasons: waits },
        { taskId: "gone", reasons: waits },
        { taskId: "t3", reasons: waits },
      ],
    });

    expect(now.queue).toEqual([
      { taskId: "t2", title: "Fix the header", projectId: "p1", place: 1, reasons: waits },
      { taskId: "t3", title: "Add a filter", projectId: "p2", place: 3, reasons: waits },
    ]);
  });

  it("carries what each running and queued Task was made for, as an Off-board Task's badge", () => {
    const onboard = { ...TASK, id: "t2", madeFor: "onboard" };
    const setUp = { ...TASK, id: "t3", state: "ready", madeFor: "run-environment-setup" };
    const now = nowOf({
      ...PARTS,
      started: [
        { task: TASK, stages: undefined },
        { task: onboard, stages: undefined },
      ],
      tasks: [setUp],
      queued: [{ taskId: "t3", reasons: [] }],
    });

    expect(now.running.map(({ taskId, madeFor }) => ({ taskId, madeFor }))).toEqual([
      { taskId: "t1", madeFor: undefined },
      { taskId: "t2", madeFor: "onboard" },
    ]);
    expect(now.queue).toEqual([
      expect.objectContaining({ taskId: "t3", madeFor: "run-environment-setup" }),
    ]);
  });
});

function failedOnboard(withCto: boolean): OffBoardTaskOnNow {
  return {
    taskId: "t1",
    kind: "onboard",
    title: "Onboard office",
    status: {
      state: "failed",
      stageName: "Verify",
      error: "The tests failed.",
      decisionId: "d1",
      withCto,
    },
  };
}

describe("nowOf's Off-board Task failed", () => {
  const onboard = { ...TASK, state: "waiting-on-you", madeFor: "onboard" };

  it("marks the out-of-tries Decision once it is the user's, with the Stage and its error", () => {
    const now = nowOf({
      ...PARTS,
      openDecisions: [{ id: "d1", threadId: "th", taskId: "t1", askedAt: at(1) }],
      tasks: [onboard],
      offBoardTasks: [failedOnboard(false)],
    });

    expect(now.needsYou).toEqual([
      expect.objectContaining({
        kind: "decision",
        decisionId: "d1",
        offBoardTask: {
          kind: "onboard",
          title: "Onboard office",
          stageName: "Verify",
          error: "The tests failed.",
        },
      }),
    ]);
  });

  it("marks none while the CTO still has it, nor any other Decision of an Off-board Task", () => {
    const withCto = nowOf({
      ...PARTS,
      openDecisions: [{ id: "d1", threadId: "th", taskId: "t1", askedAt: at(1) }],
      tasks: [onboard],
      offBoardTasks: [failedOnboard(true)],
    });
    const question = nowOf({
      ...PARTS,
      openDecisions: [{ id: "d2", threadId: "th", taskId: "t1", askedAt: at(1) }],
      tasks: [onboard],
      offBoardTasks: [
        { ...failedOnboard(false), status: { state: "waiting-on-you", decisionId: "d2" } },
      ],
    });

    expect(withCto.needsYou).toEqual([
      expect.objectContaining({ decisionId: "d1", offBoardTask: undefined }),
    ]);
    expect(question.needsYou).toEqual([
      expect.objectContaining({ decisionId: "d2", offBoardTask: undefined }),
    ]);
  });
});

describe("the fire alarm on Now", () => {
  const since = at(0);
  const byAlarm: OfficeTask = { ...TASK, state: "paused", pausedBy: "alarm" };
  const usersOwn: OfficeTask = { ...TASK, id: "t2", state: "paused", pausedBy: undefined };
  const warm: TaskResume = {
    kind: "continues-warm",
    stageName: "build Stage",
    contextTokens: 41_000,
    briefTokens: 0,
    tokens: 4_100,
  };

  it("is none while the alarm is off", () => {
    expect(nowOf(PARTS).fireAlarm).toBeUndefined();
  });

  it("lists the Tasks it paused, stopping while one has no plan yet", () => {
    const parts: NowParts = {
      ...PARTS,
      started: [
        { task: byAlarm, stages: undefined },
        { task: usersOwn, stages: undefined },
      ],
      fireAlarm: { on: true, since, way: "asap" },
      resumes: new Map([[byAlarm.id, undefined]]),
    };

    expect(nowOf(parts).fireAlarm).toEqual({
      since,
      way: "asap",
      stopping: true,
      paused: [
        {
          taskId: byAlarm.id,
          title: byAlarm.title,
          projectId: byAlarm.projectId,
          stage: undefined,
          resume: undefined,
        },
      ],
      goingOn: [],
      resumeTokens: 0,
    });
  });

  it("lists the started Tasks a softer way lets go on, beside those it paused", () => {
    const working: OfficeTask = { ...byAlarm, id: "t4", state: "in-progress", pausedBy: undefined };
    const parts: NowParts = {
      ...PARTS,
      started: [
        { task: working, stages: undefined },
        { task: usersOwn, stages: undefined },
      ],
      fireAlarm: { on: true, since, way: "after-stages" },
      resumes: new Map(),
    };

    expect(nowOf(parts).fireAlarm).toMatchObject({
      way: "after-stages",
      stopping: false,
      paused: [],
      goingOn: [
        {
          taskId: working.id,
          title: working.title,
          projectId: working.projectId,
          stage: undefined,
        },
      ],
    });
  });

  it("totals what resuming them all costs once every Stage has stopped", () => {
    const script: TaskResume = { ...warm, kind: "script", contextTokens: 0, tokens: 0 };
    const other: OfficeTask = { ...byAlarm, id: "t3" };
    const parts: NowParts = {
      ...PARTS,
      started: [
        { task: byAlarm, stages: undefined },
        { task: other, stages: undefined },
      ],
      fireAlarm: { on: true, since, way: "asap" },
      resumes: new Map([
        [byAlarm.id, warm],
        [other.id, script],
      ]),
    };

    expect(nowOf(parts).fireAlarm).toMatchObject({ stopping: false, resumeTokens: 4_100 });
  });
});

describe("nowOf's Shaping", () => {
  it("lists the Initiatives in Shaping, oldest first, with their Tasks so far and who shapes them", () => {
    const now = nowOf({
      ...PARTS,
      initiatives: [
        { id: "i2", name: "Billing", state: "shaping", createdAt: at(5) },
        { id: "i1", name: "Onboarding", state: "shaping", createdAt: at(1) },
        { id: "i3", name: "Search", state: "active", createdAt: at(0) },
      ],
      initiativeTasks: new Map([
        [
          "i1",
          [
            { projectId: "p2", state: "shaping" },
            { projectId: "p1", state: "shaping" },
            { projectId: "p2", state: "shaping" },
            { projectId: "p3", state: "dropped" },
          ],
        ],
      ]),
      shaper: "product-owner",
    });

    expect(now.shaping).toEqual([
      {
        initiativeId: "i1",
        title: "Onboarding",
        projectIds: ["p2", "p1"],
        shapedBy: "product-owner",
        taskCount: 3,
        since: at(1),
      },
      {
        initiativeId: "i2",
        title: "Billing",
        projectIds: [],
        shapedBy: "product-owner",
        taskCount: 0,
        since: at(5),
      },
    ]);
  });

  it("names nobody as its shaper while nobody holds Shapes Initiatives", () => {
    const now = nowOf({
      ...PARTS,
      initiatives: [{ id: "i1", name: "Onboarding", state: "shaping", createdAt: at(1) }],
    });

    expect(now.shaping).toMatchObject([{ initiativeId: "i1", shapedBy: undefined }]);
  });
});

function proposal(
  id: string,
  home: OpenProposal["home"],
  draftedAt: Date,
  skillUpdate?: string,
): OpenProposal {
  return { id, threadId: `thread-${id}`, draftedBy: "planner", draftedAt, home, skillUpdate };
}

describe("nowOf's Waiting for you", () => {
  const INITIATIVE: OfficeInitiative = {
    id: "i1",
    name: "Search",
    state: "shaping",
    createdAt: at(0),
  };

  const OFFICE_UPDATE = {
    target: {
      kind: "release" as const,
      version: "1.4.0",
      name: "v1.4.0",
      publishedAt: at(0),
      url: "https://github.com/office/releases/v1.4.0",
    },
    foundAt: at(6),
  };

  /** Every kind at once, each with its own time. */
  const EVERY_KIND: NowParts = {
    ...PARTS,
    tasks: [{ ...TASK, id: "t2", projectId: "p2", state: "ready" }],
    initiatives: [INITIATIVE],
    initiativeTasks: new Map([["i1", [{ projectId: "p3", state: "ready" }]]]),
    openProposals: [
      proposal("chat", { kind: "chat", roleKey: "office-manager" }, at(5)),
      proposal("task", { kind: "task", taskId: "t2" }, at(3)),
      proposal("initiative", { kind: "initiative", initiativeId: "i1" }, at(4)),
    ],
    pullRequests: [
      {
        id: "pr1",
        projectId: "p1",
        taskId: "t9",
        number: 12,
        url: "https://github.com/office/pull/12",
        checksFailing: true,
        conflicts: false,
        waitingSince: at(2),
      },
    ],
    skillUpdates: ["pdf", "docx"],
    officeUpdate: OFFICE_UPDATE,
    shapingReplies: [
      { initiativeId: "i1", threadId: "shaping-thread", roleKey: "cto", answeredAt: at(1) },
    ],
  };

  it("lists each kind oldest first, the undated Skill updates last", () => {
    const { waitingForYou } = nowOf(EVERY_KIND);

    expect(waitingForYou).toEqual([
      {
        kind: "shaping-reply",
        initiativeId: "i1",
        threadId: "shaping-thread",
        roleKey: "cto",
        projectIds: ["p3"],
        waitingSince: at(1),
      },
      {
        kind: "pull-request",
        pullRequestId: "pr1",
        taskId: "t9",
        number: 12,
        url: "https://github.com/office/pull/12",
        checksFailing: true,
        conflicts: false,
        projectIds: ["p1"],
        waitingSince: at(2),
      },
      {
        kind: "proposal",
        proposalId: "task",
        threadId: "thread-task",
        draftedBy: "planner",
        home: { kind: "task", taskId: "t2" },
        projectIds: ["p2"],
        waitingSince: at(3),
      },
      expect.objectContaining({ proposalId: "initiative", projectIds: ["p3"] }),
      expect.objectContaining({ proposalId: "chat", projectIds: [] }),
      {
        kind: "office-update",
        target: OFFICE_UPDATE.target,
        projectIds: [],
        waitingSince: at(6),
      },
      {
        kind: "skill-updates",
        skillNames: ["pdf", "docx"],
        count: 2,
        projectIds: [],
        waitingSince: undefined,
      },
    ]);
  });

  it("never adds to Needs you", () => {
    expect(nowOf(EVERY_KIND).needsYou).toEqual([]);
  });

  it("leaves out a Proposal whose Task is unknown, Done or Dropped", () => {
    for (const tasks of [
      [],
      [{ ...TASK, id: "t2", state: "done" }],
      [{ ...TASK, id: "t2", state: "dropped" }],
    ]) {
      const { waitingForYou } = nowOf({
        ...PARTS,
        tasks,
        openProposals: [proposal("task", { kind: "task", taskId: "t2" }, at(3))],
      });

      expect(waitingForYou).toEqual([]);
    }
  });

  it("leaves out a Proposal whose Initiative is unknown or ended", () => {
    for (const initiatives of [
      [],
      [{ ...INITIATIVE, state: "done" }],
      [{ ...INITIATIVE, state: "dropped" }],
    ]) {
      const { waitingForYou } = nowOf({
        ...PARTS,
        initiatives,
        openProposals: [proposal("initiative", { kind: "initiative", initiativeId: "i1" }, at(4))],
      });

      expect(waitingForYou).toEqual([]);
    }
  });

  it("leaves a Skill already drafted as an open Proposal of its update out of the Skill updates", () => {
    const chat = { kind: "chat", roleKey: "office-manager" } as const;
    const { waitingForYou } = nowOf({
      ...PARTS,
      skillUpdates: ["pdf", "docx"],
      openProposals: [proposal("update", chat, at(1), "pdf")],
    });

    expect(waitingForYou).toMatchObject([
      { kind: "proposal", proposalId: "update" },
      { kind: "skill-updates", skillNames: ["docx"], count: 1 },
    ]);
  });

  it("lists no Skill updates once every one is drafted", () => {
    const chat = { kind: "chat", roleKey: "office-manager" } as const;
    const { waitingForYou } = nowOf({
      ...PARTS,
      skillUpdates: ["pdf"],
      openProposals: [proposal("update", chat, at(1), "pdf")],
    });

    expect(waitingForYou.map(({ kind }) => kind)).toEqual(["proposal"]);
  });

  it("lists a shaper's answer only while its Initiative is in Shaping", () => {
    const { waitingForYou } = nowOf({
      ...EVERY_KIND,
      initiatives: [{ ...INITIATIVE, state: "active" }],
      openProposals: [],
    });

    expect(waitingForYou.map(({ kind }) => kind)).not.toContain("shaping-reply");
  });
});
