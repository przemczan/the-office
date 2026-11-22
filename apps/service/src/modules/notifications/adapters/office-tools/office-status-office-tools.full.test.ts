import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { SHOW_OFFICE_STATUS_TOOL } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { NotificationsModule } from "../../notifications.module.js";
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
  OpenProposalsForTests,
  PullRequestsWaitingForTests,
  SkillUpdatesFoundForTests,
  OfficeUpdateAvailableForTests,
  ShapingRepliesForTests,
  OfficeUsersForTests,
  OfficeInitiativesForTests,
  OfficeTasksForTests,
  OpenDecisionsForTests,
  TaskStageProgressForTests,
} from "../../ports/notifications-ports.fixtures.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";

describe("the show_office_status tool", () => {
  let app: INestApplication;

  beforeEach(async () => {
    ({ app } = await startTestApplication({
      database: true,
      imports: [
        EventsModule,
        EventStreamModule,
        NotificationsModule.register({
          imports: [NotificationsPortsForTestsModule],
          officeTasks: OfficeTasksForTests,
          officeInitiatives: OfficeInitiativesForTests,
          openDecisions: OpenDecisionsForTests,
          taskStageProgress: TaskStageProgressForTests,
          deskLimit: DeskLimitForTests,
          startQueue: StartQueueForTests,
          knownPeople: KnownPeopleForTests,
          accountUsage: AccountUsageForTests,
          officeStatusCards: OfficeStatusCardsForTests,
          officeFireAlarm: OfficeFireAlarmForTests,
          resumePlans: ResumePlansForTests,
          standInChoicesWaiting: StandInChoicesWaitingForTests,
          openProposals: OpenProposalsForTests,
          pullRequestsWaiting: PullRequestsWaitingForTests,
          skillUpdatesFound: SkillUpdatesFoundForTests,
          officeUpdateAvailable: OfficeUpdateAvailableForTests,
          shapingReplies: ShapingRepliesForTests,
          officeUsers: OfficeUsersForTests,
        }),
      ],
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("posts the Office status card in the chat and gives the Agent the status in words, Office-wide", async () => {
    const taskId = randomUUID();
    app.get(OfficeTasksForTests).tasks = [
      {
        id: taskId,
        title: "Add a filter",
        projectId: "p1",
        state: "waiting-on-you",
        pausedBy: undefined,
        resumesAt: undefined,
      },
    ];
    app.get(OpenDecisionsForTests).open = [
      {
        id: randomUUID(),
        threadId: randomUUID(),
        taskId,
        askedAt: new Date("2026-10-27T09:05:00Z"),
      },
    ];
    const [tool] = app.get(OfficeToolRegistry).named([SHOW_OFFICE_STATUS_TOOL]);
    if (!tool) throw new Error("No show_office_status tool.");

    const result = await tool.run({}, anOfficeToolCall("office-manager-session"));

    expect(app.get(OfficeStatusCardsForTests).postedIn).toEqual(["office-manager-session"]);
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Waiting on the user: 1 Decision.");
    expect(result.text).toContain(
      `- Add a filter (Task ${taskId}) · Waiting on you, before its first Stage`,
    );
    expect(result.text).toContain("The Office status card is in this chat");
  });
});
