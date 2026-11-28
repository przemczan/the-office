import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { nowSchema, type Now } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import type { DomainEvent, DomainEventClass } from "../../../platform/events/domain-event.js";
import {
  DecisionClosed,
  DecisionOpened,
  MessagesLogged,
  ProposalApplied,
  ProposalDeclined,
  ProposalDrafted,
} from "../../conversations/index.js";
import {
  OfficeRestartScheduled,
  OfficeUpdateChecked,
  OfficeUpdateScheduled,
  ScheduledExitCancelled,
} from "../../office-updates/index.js";
import { StandInChoicesChanged } from "../../pipelines/index.js";
import {
  PullRequestClosed,
  PullRequestMerged,
  PullRequestOpened,
  PullRequestReopened,
  PullRequestsChecked,
} from "../../projects/index.js";
import {
  SkillRemoved,
  SkillUpdated,
  SkillUpdateFound,
  SkillUpdateGone,
} from "../../skills/index.js";
import { InitiativeStateChanged } from "../../work/index.js";
import { NowChanged } from "../domain/now-events.js";
import { NotificationsModule } from "../notifications.module.js";
import {
  AccountUsageForTests,
  DeskLimitForTests,
  StartQueueForTests,
  KnownPeopleForTests,
  NotificationsPortsForTestsModule,
  OfficeFireAlarmForTests,
  OfficeStatusCardsForTests,
  ResumePlansForTests,
  StandInChoicesWaitingForTests,
  PullRequestsWaitingForTests,
  SkillUpdatesFoundForTests,
  OfficeUpdateAvailableForTests,
  WaitingInConversationsForTests,
  OfficeUsersForTests,
  OfficeOffBoardTasksForTests,
  OfficeInitiativesForTests,
  OfficeTasksForTests,
  TaskStageProgressForTests,
} from "../ports/notifications-ports.fixtures.js";

describe("NowService", () => {
  let app: INestApplication;
  let url: string;
  let events: EventBus;
  let tasks: OfficeTasksForTests;
  let announced: NowChanged[];

  beforeEach(async () => {
    ({ app, url } = await startTestApplication({
      database: true,
      imports: [
        EventsModule,
        EventStreamModule,
        NotificationsModule.register({
          imports: [NotificationsPortsForTestsModule],
          officeTasks: OfficeTasksForTests,
          officeInitiatives: OfficeInitiativesForTests,
          taskStageProgress: TaskStageProgressForTests,
          deskLimit: DeskLimitForTests,
          startQueue: StartQueueForTests,
          knownPeople: KnownPeopleForTests,
          accountUsage: AccountUsageForTests,
          officeStatusCards: OfficeStatusCardsForTests,
          officeFireAlarm: OfficeFireAlarmForTests,
          resumePlans: ResumePlansForTests,
          standInChoicesWaiting: StandInChoicesWaitingForTests,
          pullRequestsWaiting: PullRequestsWaitingForTests,
          skillUpdatesFound: SkillUpdatesFoundForTests,
          officeUpdateAvailable: OfficeUpdateAvailableForTests,
          waitingInConversations: WaitingInConversationsForTests,
          officeUsers: OfficeUsersForTests,
          officeOffBoardTasks: OfficeOffBoardTasksForTests,
        }),
      ],
    }));
    events = app.get(EventBus);
    tasks = app.get(OfficeTasksForTests);
    announced = [];
    events.subscribe(NowChanged, (event) => void announced.push(event));
  });

  afterEach(async () => {
    await app.close();
  });

  async function readNow(): Promise<Now> {
    const response = await fetch(`${url}/api/now`);
    expect(response.status).toBe(200);
    return nowSchema.parse(await response.json());
  }

  it("reads what waits, what runs and the desks from the modules that own them", async () => {
    const taskId = randomUUID();
    const decisionId = randomUUID();
    tasks.tasks = [
      {
        id: taskId,
        title: "Add a filter",
        projectId: "p1",
        state: "in-progress",
        pausedBy: undefined,
        resumesAt: undefined,
      },
    ];
    app.get(TaskStageProgressForTests).stages.set(taskId, [
      {
        stage: { key: "build", name: "Build", kind: "agent", role: "developer" },
        state: "running",
        runs: [{ startedAt: new Date("2026-10-27T09:00:00Z"), endedAt: undefined }],
      },
    ]);
    app.get(WaitingInConversationsForTests).decisions = [
      { id: decisionId, threadId: randomUUID(), taskId, askedAt: new Date("2026-10-27T09:05:00Z") },
    ];
    app.get(DeskLimitForTests).limit = 4;
    const usage = app.get(AccountUsageForTests).readingsByEngine;
    usage.set("claude-code", {
      fiveHour: { percentUsed: 42, resetsAt: new Date("2026-10-27T12:00:00Z") },
      sevenDay: { percentUsed: 17, resetsAt: new Date("2026-10-30T09:00:00Z") },
    });
    usage.set("work-account", {
      fiveHour: { percentUsed: 0, resetsAt: undefined },
      sevenDay: { percentUsed: 5, resetsAt: new Date("2026-11-01T09:00:00Z") },
    });

    const now = await readNow();

    expect(now.needsYou).toEqual([
      {
        kind: "decision",
        decisionId,
        taskId,
        projectId: "p1",
        waitingSince: "2026-10-27T09:05:00.000Z",
        offBoardTask: null,
      },
    ]);
    expect(now.running).toEqual([
      {
        taskId,
        title: "Add a filter",
        projectId: "p1",
        state: "in-progress",
        pausedBy: null,
        resumesAt: null,
        stage: {
          key: "build",
          name: "Build",
          role: "developer",
          since: "2026-10-27T09:00:00.000Z",
        },
        madeFor: null,
      },
    ]);
    expect(now.desks).toEqual({ inUse: 1, limit: 4 });
    expect(now.usageWindows).toEqual([
      {
        engineId: "claude-code",
        fiveHour: { percentUsed: 42, resetsAt: "2026-10-27T12:00:00.000Z" },
        sevenDay: { percentUsed: 17, resetsAt: "2026-10-30T09:00:00.000Z" },
      },
      {
        engineId: "work-account",
        fiveHour: { percentUsed: 0, resetsAt: null },
        sevenDay: { percentUsed: 5, resetsAt: "2026-11-01T09:00:00.000Z" },
      },
    ]);
  });

  it("marks an Off-board Task's out-of-tries Decision once it is the user's, and what each Task was made for", async () => {
    const taskId = randomUUID();
    const queuedId = randomUUID();
    const decisionId = randomUUID();
    tasks.tasks = [
      {
        id: taskId,
        title: "Set up the run environment",
        projectId: "p1",
        state: "waiting-on-you",
        pausedBy: undefined,
        resumesAt: undefined,
        madeFor: "run-environment-setup",
      },
      {
        id: queuedId,
        title: "Onboard p2",
        projectId: "p2",
        state: "ready",
        pausedBy: undefined,
        resumesAt: undefined,
        madeFor: "onboard",
      },
    ];
    app.get(WaitingInConversationsForTests).decisions = [
      { id: decisionId, threadId: randomUUID(), taskId, askedAt: new Date("2026-10-27T09:05:00Z") },
    ];
    app.get(StartQueueForTests).queued = [
      {
        taskId: queuedId,
        reasons: ["The Project limit is reached: 1 of its Tasks is running."],
        shortReasons: ["Project limit reached (1)"],
      },
    ];
    app.get(OfficeOffBoardTasksForTests).offBoardTasks.set(taskId, {
      taskId,
      kind: "run-environment-setup",
      title: "Set up the run environment",
      status: {
        state: "failed",
        stageName: "Verify",
        error: undefined,
        decisionId,
        withCto: false,
      },
    });

    const now = await readNow();

    expect(now.needsYou).toEqual([
      expect.objectContaining({
        kind: "decision",
        decisionId,
        offBoardTask: {
          kind: "run-environment-setup",
          title: "Set up the run environment",
          stageName: "Verify",
          error: null,
        },
      }),
    ]);
    expect(now.running).toEqual([
      expect.objectContaining({ taskId, madeFor: "run-environment-setup" }),
    ]);
    expect(now.queue).toEqual([
      expect.objectContaining({
        taskId: queuedId,
        madeFor: "onboard",
        place: 1,
        shortReasons: ["Project limit reached (1)"],
      }),
    ]);
  });

  it("no longer lists a Decision its Task's Drop closed, and announces it", async () => {
    const taskId = randomUUID();
    const decision = {
      id: randomUUID(),
      threadId: randomUUID(),
      taskId,
      askedAt: new Date("2026-10-27T09:05:00Z"),
    };
    tasks.tasks = [
      {
        id: taskId,
        title: "Add a filter",
        projectId: "p1",
        state: "waiting-on-you",
        pausedBy: undefined,
        resumesAt: undefined,
      },
    ];
    const waiting = app.get(WaitingInConversationsForTests);
    waiting.decisions = [decision];
    await events.publish(decisionEvent(DecisionOpened, decision));
    await vi.waitFor(() =>
      expect(announced.at(-1)?.now.needsYou).toEqual([
        expect.objectContaining({ kind: "decision", decisionId: decision.id }),
      ]),
    );

    waiting.decisions = [];
    await events.publish(decisionEvent(DecisionClosed, decision));

    await vi.waitFor(() => expect(announced.at(-1)?.now.needsYou).toEqual([]));
    expect((await readNow()).needsYou).toEqual([]);
  });

  it("lists the Stages waiting for a Stand-in Engine as one item, announced as they change", async () => {
    const choices = app.get(StandInChoicesWaitingForTests);
    const choice = {
      resetsAt: "2026-10-27T14:00:00.000Z",
      standInNow: { engineName: "Spare" },
      asked: { engineName: "Spare" },
    };
    choices.choices = [
      {
        ...choice,
        taskId: randomUUID(),
        projectId: "p1",
        waitingSince: new Date("2026-10-27T09:05:00Z"),
      },
      {
        ...choice,
        taskId: randomUUID(),
        projectId: "p2",
        waitingSince: new Date("2026-10-27T09:10:00Z"),
      },
    ];

    const now = await readNow();

    expect(now.needsYou).toEqual([
      {
        kind: "stand-in-choice",
        projectIds: ["p1", "p2"],
        waitingSince: "2026-10-27T09:05:00.000Z",
        count: 2,
      },
    ]);
    // Needs you's tab counts the card as one, however many Stages wait.
    expect(now.needsYou).toHaveLength(1);

    choices.choices = [];
    await events.publish(new StandInChoicesChanged(randomUUID()));

    await vi.waitFor(() => expect(announced.at(-1)?.now.needsYou).toEqual([]));
  });

  it("carries the fire alarm while it is on, with how each Task it paused would resume", async () => {
    const taskId = randomUUID();
    tasks.tasks = [
      {
        id: taskId,
        title: "Add a filter",
        projectId: "p1",
        state: "paused",
        pausedBy: "alarm",
        resumesAt: undefined,
      },
    ];
    const alarm = app.get(OfficeFireAlarmForTests);
    const off = await readNow();
    alarm.alarm = { on: true, since: new Date("2026-10-29T09:00:00Z"), way: "asap" };
    const stopping = await readNow();
    app.get(ResumePlansForTests).resumes.set(taskId, {
      kind: "re-caches",
      stageName: "Build",
      contextTokens: 12_000,
      briefTokens: 0,
      tokens: 12_000,
    });

    const planned = await readNow();

    expect(off.fireAlarm).toBeNull();
    expect(stopping.fireAlarm).toMatchObject({
      stopping: true,
      paused: [{ taskId, resume: null }],
    });
    expect(planned.fireAlarm).toEqual({
      since: "2026-10-29T09:00:00.000Z",
      way: "asap",
      stopping: false,
      paused: [
        {
          taskId,
          title: "Add a filter",
          projectId: "p1",
          stage: null,
          resume: {
            kind: "re-caches",
            stageName: "Build",
            contextTokens: 12_000,
            briefTokens: 0,
            tokens: 12_000,
          },
        },
      ],
      goingOn: [],
      resumeTokens: 12_000,
    });
  });

  it("lists the Initiatives in Shaping, oldest first, shaped by nobody while nobody holds the duty", async () => {
    const [older, newer] = [randomUUID(), randomUUID()];
    const initiatives = app.get(OfficeInitiativesForTests);
    initiatives.initiatives = [
      { id: newer, name: "Billing", state: "shaping", createdAt: new Date("2026-11-15T10:00:00Z") },
      { id: randomUUID(), name: "Search", state: "active", createdAt: new Date("2026-11-01") },
      {
        id: older,
        name: "Onboarding",
        state: "shaping",
        createdAt: new Date("2026-11-15T08:00:00Z"),
      },
    ];
    initiatives.tasks.set(older, [
      { projectId: "p1", state: "shaping" },
      { projectId: "p2", state: "shaping" },
    ]);

    const nobody = await readNow();
    app.get(KnownPeopleForTests).holders.set("shapes-initiatives", "product-owner");
    const held = await readNow();

    expect(nobody.shaping).toEqual([
      {
        initiativeId: older,
        title: "Onboarding",
        projectIds: ["p1", "p2"],
        shapedBy: null,
        taskCount: 2,
        since: "2026-11-15T08:00:00.000Z",
      },
      {
        initiativeId: newer,
        title: "Billing",
        projectIds: [],
        shapedBy: null,
        taskCount: 0,
        since: "2026-11-15T10:00:00.000Z",
      },
    ]);
    expect(held.shaping.map(({ shapedBy }) => shapedBy)).toEqual([
      "product-owner",
      "product-owner",
    ]);
  });

  it("announces Now once an Initiative leaves Shaping", async () => {
    const initiativeId = randomUUID();
    const initiatives = app.get(OfficeInitiativesForTests);
    const shaping = {
      id: initiativeId,
      name: "Onboarding",
      state: "shaping",
      createdAt: new Date(),
    };
    initiatives.initiatives = [shaping];
    await events.publish(new InitiativeStateChanged(randomUUID(), "shaping", "active"));
    await vi.waitFor(() =>
      expect(announced.at(-1)?.now.shaping).toEqual([expect.objectContaining({ initiativeId })]),
    );

    initiatives.initiatives = [{ ...shaping, state: "active" }];
    await events.publish(new InitiativeStateChanged(initiativeId, "shaping", "active"));

    await vi.waitFor(() => expect(announced.at(-1)?.now.shaping).toEqual([]));
  });

  describe("Waiting for you", () => {
    it("reads each kind from the modules that own it, apart from Needs you", async () => {
      const [taskId, initiativeId, shapingThread] = [randomUUID(), randomUUID(), randomUUID()];
      const [proposalId, pullRequestId] = [randomUUID(), randomUUID()];
      tasks.tasks = [
        {
          id: taskId,
          title: "Add a filter",
          projectId: "p1",
          state: "ready",
          pausedBy: undefined,
          resumesAt: undefined,
        },
      ];
      const initiatives = app.get(OfficeInitiativesForTests);
      initiatives.initiatives = [
        { id: initiativeId, name: "Search", state: "shaping", createdAt: new Date("2026-11-01") },
        { id: randomUUID(), name: "Billing", state: "active", createdAt: new Date("2026-11-01") },
      ];
      initiatives.tasks.set(initiativeId, [{ projectId: "p2", state: "ready" }]);
      app.get(WaitingInConversationsForTests).proposals = [
        {
          id: proposalId,
          threadId: randomUUID(),
          draftedBy: "planner",
          draftedAt: new Date("2026-11-20T09:03:00Z"),
          home: { kind: "task", taskId },
          skillUpdate: undefined,
        },
      ];
      app.get(PullRequestsWaitingForTests).pullRequests = [
        {
          id: pullRequestId,
          projectId: "p1",
          taskId,
          number: 7,
          url: "https://github.com/office/the-office/pull/7",
          checksFailing: false,
          conflicts: true,
          waitingSince: new Date("2026-11-20T09:02:00Z"),
        },
      ];
      app.get(SkillUpdatesFoundForTests).names = ["pdf"];
      app.get(OfficeUpdateAvailableForTests).found = {
        target: {
          kind: "commit",
          commit: "0123456789abcdef",
          shortCommit: "0123456",
          subject: "feat: faster Now",
          committedAt: new Date("2026-11-19T12:00:00Z"),
        },
        foundAt: new Date("2026-11-20T09:04:00Z"),
      };
      const replies = app.get(WaitingInConversationsForTests);
      replies.replies = [
        {
          initiativeId,
          threadId: shapingThread,
          roleKey: "cto",
          answeredAt: new Date("2026-11-20T09:01:00Z"),
        },
      ];

      const now = await readNow();

      expect(now.needsYou).toEqual([]);
      expect(now.waitingForYou).toEqual([
        {
          kind: "shaping-reply",
          initiativeId,
          threadId: shapingThread,
          roleKey: "cto",
          projectIds: ["p2"],
          waitingSince: "2026-11-20T09:01:00.000Z",
        },
        {
          kind: "pull-request",
          pullRequestId,
          taskId,
          number: 7,
          url: "https://github.com/office/the-office/pull/7",
          checksFailing: false,
          conflicts: true,
          projectIds: ["p1"],
          waitingSince: "2026-11-20T09:02:00.000Z",
        },
        expect.objectContaining({ kind: "proposal", proposalId, projectIds: ["p1"] }),
        {
          kind: "office-update",
          target: {
            kind: "commit",
            commit: "0123456789abcdef",
            shortCommit: "0123456",
            subject: "feat: faster Now",
            committedAt: "2026-11-19T12:00:00.000Z",
          },
          projectIds: [],
          waitingSince: "2026-11-20T09:04:00.000Z",
        },
        {
          kind: "skill-updates",
          skillNames: ["pdf"],
          count: 1,
          projectIds: [],
          waitingSince: null,
        },
      ]);
      // Shaping replies are asked for the Initiatives in Shaping alone.
      expect(replies.asked.at(-1)).toEqual([initiativeId]);
    });

    // Now reads nothing off these events, so a bare instance of each class stands in for one.
    it.each<DomainEventClass>([
      ProposalDrafted,
      ProposalApplied,
      ProposalDeclined,
      PullRequestOpened,
      PullRequestsChecked,
      PullRequestMerged,
      PullRequestClosed,
      PullRequestReopened,
      SkillUpdateFound,
      SkillUpdateGone,
      SkillUpdated,
      SkillRemoved,
      OfficeUpdateChecked,
      OfficeUpdateScheduled,
      OfficeRestartScheduled,
      ScheduledExitCancelled,
    ])("announces Now on %O", async (eventClass) => {
      const name = randomUUID();
      app.get(SkillUpdatesFoundForTests).names = [name];

      await events.publish(bareEvent(eventClass));

      await vi.waitFor(() =>
        expect(announced.at(-1)?.now.waitingForYou).toEqual([
          expect.objectContaining({ kind: "skill-updates", skillNames: [name] }),
        ]),
      );
    });

    it("announces Now on the user's message in an Initiative's Thread", async () => {
      const name = randomUUID();
      app.get(SkillUpdatesFoundForTests).names = [name];

      await events.publish(
        Object.assign(bareEvent(MessagesLogged), {
          thread: { home: { kind: "initiative", initiativeId: randomUUID() } },
          messages: [{ kind: "user" }],
        }),
      );

      await vi.waitFor(() =>
        expect(announced.at(-1)?.now.waitingForYou).toEqual([
          expect.objectContaining({ skillNames: [name] }),
        ]),
      );
    });
  });
});

function bareEvent(eventClass: DomainEventClass): DomainEvent {
  return Object.create(eventClass.prototype) as DomainEvent;
}

type DecisionEventParameters = ConstructorParameters<typeof DecisionOpened>;

/** Only what Now reads of a Decision: which one, on which Task. */
function decisionEvent(
  eventClass: typeof DecisionOpened | typeof DecisionClosed,
  decision: { readonly id: string; readonly taskId: string },
): DecisionOpened | DecisionClosed {
  const [thread, asked] = [{ home: { kind: "task" } }, decision] as unknown as [
    DecisionEventParameters[0],
    DecisionEventParameters[1],
  ];
  return new eventClass(thread, asked, new Date());
}
