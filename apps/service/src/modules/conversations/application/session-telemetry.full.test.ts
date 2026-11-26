import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { OfficeToolRegistry } from "../../engine/index.js";
import { RoleCards } from "../../people/index.js";
import { aThread } from "../domain/thread.fixtures.js";
import type { Thread } from "../domain/thread.js";
import { ChangesAllowedRepository } from "../ports/changes-allowed-repository.js";
import { ProjectBases } from "../ports/project-bases.js";
import { projectBasesOver } from "../ports/project-bases.fixtures.js";
import { NO_MASK, ProjectOutputMasks } from "../ports/project-output-masks.js";
import { Briefs } from "./briefs.js";
import { CallChains } from "./call-chains.js";
import { dutiesProvider } from "./duties.fixtures.js";
import { InitiativeThreadSetups } from "./initiative-thread-setups.js";
import { SessionPlaces } from "./session-places.js";
import { stageThreadTelemetry } from "./stage-threads.js";
import { TaskThreadSetups, type TaskThreadSetup } from "./task-thread-setups.js";
import { threadTelemetry } from "./thread-runner.js";
import { ConversationsPromptTemplatesForTests } from "../adapters/prompt-templates/conversations-prompt-templates.fixtures.js";
import {
  PromptTemplateRepository,
  PromptTemplateRepositoryForTests,
} from "../../prompt-templates/index.fixtures.js";

const TASK = "11111111-1111-4111-8111-111111111111";
const INITIATIVE = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";

/** The ids no metric may carry (spec §5.2): only spans and the `office.engine.call` record do. */
const IDS = [TASK, INITIATIVE, THREAD];

let app: INestApplication;
let places: SessionPlaces;

const BRIEF = { text: "The record.", tokens: 3 };

function taskSetup(): TaskThreadSetup {
  return {
    projectId: "admin-panel",
    initiativeId: INITIATIVE,
    projectName: "Admin panel",
    pipelineName: "Feature",
    folder: "/office/worktrees/admin-panel/task",
    environment: {},
    useProjectSkills: false,
    projectSkillsOff: [],
    instructions: "On this Task you plan.",
    officeTools: [],
    brief: "The record.",
    asking: false,
    sessionRefusal: undefined,
  };
}

beforeAll(async () => {
  ({ app } = await startTestApplication({
    imports: [ConversationsPromptTemplatesForTests],
    // No database: the templates render their defaults.
    overrides: [
      { provide: PromptTemplateRepository, useValue: new PromptTemplateRepositoryForTests() },
    ],
    providers: [
      SessionPlaces,
      TaskThreadSetups,
      InitiativeThreadSetups,
      dutiesProvider(),
      { provide: ProjectBases, useValue: projectBasesOver("/office/bases", []) },
      {
        provide: Briefs,
        useValue: {
          forTaskThread: () => Promise.resolve(BRIEF),
          forInitiativeThread: () => Promise.resolve(BRIEF),
          forThread: () => Promise.resolve(BRIEF),
        },
      },
      { provide: ChangesAllowedRepository, useValue: { isAllowed: () => Promise.resolve(false) } },
      { provide: ProjectOutputMasks, useValue: { outputMaskOf: () => Promise.resolve(NO_MASK) } },
      { provide: CallChains, useValue: { ofCaller: () => Promise.resolve([]) } },
      { provide: RoleCards, useValue: { find: () => Promise.resolve(undefined) } },
      {
        provide: OfficeToolRegistry,
        useValue: { actionTools: () => [] },
      },
    ],
  }));
  app.get(TaskThreadSetups).provide({
    planner: () => Promise.resolve("planner"),
    readyForPersonsThread: () => Promise.resolve(undefined),
    planningThreadElsewhere: () => Promise.resolve(undefined),
    setUp: () => Promise.resolve(taskSetup()),
  });
  app.get(InitiativeThreadSetups).provide({
    setUp: () =>
      Promise.resolve({
        instructions: "On this Initiative you plan.",
        officeTools: [],
        record: "The record.",
        sessionRefusal: undefined,
        branchReads: undefined,
      }),
  });
  places = app.get(SessionPlaces);
});

afterAll(async () => {
  await app.close();
});

async function telemetryOf(thread: Thread) {
  return threadTelemetry(thread, thread.roleKey, await places.of(thread));
}

function expectNoIds(metric: Readonly<Record<string, unknown>>): void {
  for (const value of Object.values(metric)) expect(IDS).not.toContain(value);
}

describe("what a session's engine calls carry", () => {
  it("in a Stage: the Task, its Initiative, the Thread and the Stage run on the span, only names on the metric", () => {
    const telemetry = stageThreadTelemetry(THREAD, "developer", {
      taskId: TASK,
      initiativeId: INITIATIVE,
      stageName: "Implement",
      stageRun: 3,
      pipelineName: "Feature",
      projectName: "Admin panel",
    });

    expect(telemetry).toEqual({
      span: {
        "office.task": TASK,
        "office.initiative": INITIATIVE,
        "office.thread": THREAD,
        "office.role": "developer",
        "office.stage": "Implement",
        "office.stage.run": 3,
        "office.pipeline": "Feature",
        "office.project": "Admin panel",
      },
      metric: {
        "office.conversation.home": "task",
        "office.role": "developer",
        "office.stage": "Implement",
        "office.pipeline": "Feature",
        "office.project": "Admin panel",
      },
    });
    expectNoIds(telemetry.metric);
  });

  it("in a Stage of a Task in no Initiative: the Initiative empty", () => {
    const { span } = stageThreadTelemetry(THREAD, "developer", {
      taskId: TASK,
      initiativeId: undefined,
      stageName: "Implement",
      stageRun: 1,
      pipelineName: "Feature",
      projectName: "Admin panel",
    });

    expect(span["office.initiative"]).toBe("");
  });

  it("in a Task's planning Thread: the Task and its Initiative on the span, the Project's and Pipeline's names on the metric, no Stage", async () => {
    const thread = aThread({
      id: THREAD,
      home: { kind: "task", taskId: TASK },
      roleKey: "planner",
    });

    const telemetry = await telemetryOf(thread);

    expect(telemetry).toEqual({
      span: {
        "office.task": TASK,
        "office.initiative": INITIATIVE,
        "office.thread": THREAD,
        "office.role": "planner",
      },
      metric: {
        "office.conversation.home": "task",
        "office.role": "planner",
        "office.stage": "",
        "office.pipeline": "Feature",
        "office.project": "Admin panel",
      },
    });
    expectNoIds(telemetry.metric);
  });

  it("in an Initiative's Thread: the Initiative on the span, no Project nor Pipeline on the metric", async () => {
    const thread = aThread({
      id: THREAD,
      home: { kind: "initiative", initiativeId: INITIATIVE },
      roleKey: "planner",
    });

    const telemetry = await telemetryOf(thread);

    expect(telemetry).toEqual({
      span: { "office.initiative": INITIATIVE, "office.thread": THREAD, "office.role": "planner" },
      metric: {
        "office.conversation.home": "initiative",
        "office.role": "planner",
        "office.stage": "",
        "office.pipeline": "",
        "office.project": "",
      },
    });
    expectNoIds(telemetry.metric);
  });

  it("in a chat: only the Thread and the person on the span, every name empty on the metric", async () => {
    const thread = aThread({ id: THREAD, home: { kind: "chat", roleKey: "planner" } });

    const telemetry = await telemetryOf(thread);

    expect(telemetry).toEqual({
      span: { "office.thread": THREAD, "office.role": "planner" },
      metric: {
        "office.conversation.home": "chat",
        "office.role": "planner",
        "office.stage": "",
        "office.pipeline": "",
        "office.project": "",
      },
    });
    expectNoIds(telemetry.metric);
  });
});
