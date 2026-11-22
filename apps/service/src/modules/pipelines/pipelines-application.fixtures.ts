import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module, type DynamicModule, type INestApplication } from "@nestjs/common";
import { startTestApplication, type ProviderOverride } from "../../../test/test-application.js";
import type { DomainEvent } from "../../platform/events/domain-event.js";
import { EventBus } from "../../platform/events/event-bus.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { OfficeDataModule } from "../../platform/office-data/office-data.module.js";
import { Telemetry } from "../../platform/telemetry/telemetry.js";
import { TelemetryModule } from "../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import {
  EngineModule,
  ScriptedEngine,
  ScriptedEngineModule,
  type EngineId,
  type SessionScript,
  type ScriptedEngineProcess,
} from "../engine/index.js";
import { StageInterpreter } from "./application/stage-interpreter.js";
import type { Stage } from "./domain/stage.js";
import type { StageRun } from "./domain/stage-run.js";
import type { DecisionAnswer } from "./domain/walk-decisions.js";
import type { AskedDecision } from "./ports/stage-threads.js";
import { PipelinesModule } from "./pipelines.module.js";
import {
  KnownPeopleForTests,
  PipelineInitiativesForTests,
  ProjectDefaultsForTests,
  PipelinesPortsForTestsModule,
  ProposalDraftsForTests,
  RoleEngineCascadeForTests,
  RunEnvironmentDefinitionsForTests,
  StageRoleEnginesForTests,
  StageDecisionsForTests,
  StageThreadMessagesForTests,
  StageThreadsForTests,
  StartedTasksForTests,
  TaskUsageForTests,
  StageContextLimitDefaultsForTests,
  TaskCommandsForTests,
  TaskGitForTests,
  TaskPublishingForTests,
  TaskRecordsForTests,
  TaskScreenshotsForTests,
  TaskThreadSessionsForTests,
} from "./ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "./ports/stage-run-repository.js";
import { TaskStagesRepository } from "./ports/task-stages-repository.js";

/** The Pipelines module on the test database, its ports' stand-ins, and every event it publishes. */
export interface PipelinesApplication {
  readonly app: INestApplication;
  /** Replays the Agent Stages' sessions. */
  readonly engine: ScriptedEngine;
  readonly tasks: StartedTasksForTests;
  readonly records: TaskRecordsForTests;
  readonly people: KnownPeopleForTests;
  readonly projects: ProjectDefaultsForTests;
  readonly stageThreads: StageThreadsForTests;
  readonly threadMessages: StageThreadMessagesForTests;
  readonly decisions: StageDecisionsForTests;
  readonly git: TaskGitForTests;
  readonly commands: TaskCommandsForTests;
  readonly publishing: TaskPublishingForTests;
  readonly screenshots: TaskScreenshotsForTests;
  readonly usage: TaskUsageForTests;
  readonly contextLimitDefaults: StageContextLimitDefaultsForTests;
  readonly threadSessions: TaskThreadSessionsForTests;
  readonly roleEngines: StageRoleEnginesForTests;
  readonly cascade: RoleEngineCascadeForTests;
  readonly definitions: RunEnvironmentDefinitionsForTests;
  readonly initiatives: PipelineInitiativesForTests;
  readonly published: DomainEvent[];
}

/** Telemetry a test reads its spans from, in place of the no-op one. */
@Module({})
class TelemetryForTestsModule {
  static register(telemetry: Telemetry): DynamicModule {
    return {
      module: TelemetryForTestsModule,
      global: true,
      providers: [{ provide: Telemetry, useValue: telemetry }],
      exports: [Telemetry],
    };
  }
}

/**
 * Agent Stages' sessions replay `scripts` in order, one per Stage, each with a real
 * `engineProcess` when a test gives one; spans go to `telemetry` when a test gives one.
 */
export async function startPipelinesApplication(
  scripts: readonly SessionScript[] = [],
  engineProcess?: ScriptedEngineProcess,
  telemetry?: Telemetry,
): Promise<PipelinesApplication> {
  return startOn(new ScriptedEngine(scripts, {}, engineProcess), [], telemetry);
}

/**
 * As `startPipelinesApplication`, every Agent Stage's session on the engine `engineId`, replaying
 * `scripts` with `capabilities`, such as a Codex engine's; `overrides` list it, such as Settings ›
 * Engines of the test's own.
 */
export async function startPipelinesApplicationOn(
  { engineId, capabilities, overrides }: PipelinesEngine,
  scripts: readonly SessionScript[],
): Promise<PipelinesApplication> {
  const pipelines = await startOn(new ScriptedEngine(scripts, capabilities), overrides);
  pipelines.stageThreads.engineId = engineId;
  return pipelines;
}

/** As `startPipelinesApplication`, with `overrides` replacing providers, such as a repository. */
export function startPipelinesApplicationWith(
  overrides: readonly ProviderOverride[],
  scripts: readonly SessionScript[],
): Promise<PipelinesApplication> {
  return startOn(new ScriptedEngine(scripts), overrides);
}

/** The engine a test's Agent Stages run on, and what lists it. */
export interface PipelinesEngine {
  readonly engineId: EngineId;
  readonly capabilities: ConstructorParameters<typeof ScriptedEngine>[1];
  readonly overrides: readonly ProviderOverride[];
}

async function startOn(
  engine: ScriptedEngine,
  overrides: readonly ProviderOverride[],
  telemetry?: Telemetry,
): Promise<PipelinesApplication> {
  const engineModule = ScriptedEngineModule.register(engine);
  const { app } = await startTestApplication({
    database: true,
    overrides,
    imports: [
      EventsModule,
      EventStreamModule,
      OfficeDataModule.forRoot(await mkdtemp(join(tmpdir(), "office-pipelines-"))),
      telemetry ? TelemetryForTestsModule.register(telemetry) : TelemetryModule,
      engineModule,
      PipelinesModule.register({
        imports: [PipelinesPortsForTestsModule.register([engineModule])],
        startedTasks: StartedTasksForTests,
        taskRecords: TaskRecordsForTests,
        knownPeople: KnownPeopleForTests,
        projectDefaults: ProjectDefaultsForTests,
        stageThreads: StageThreadsForTests,
        stageThreadMessages: StageThreadMessagesForTests,
        stageDecisions: StageDecisionsForTests,
        taskGit: TaskGitForTests,
        taskCommands: TaskCommandsForTests,
        taskPublishing: TaskPublishingForTests,
        taskScreenshots: TaskScreenshotsForTests,
        taskUsage: TaskUsageForTests,
        stageContextLimitDefaults: StageContextLimitDefaultsForTests,
        taskThreadSessions: TaskThreadSessionsForTests,
        proposalDrafts: ProposalDraftsForTests,
        stageRoleEngines: StageRoleEnginesForTests,
        roleEngineCascade: RoleEngineCascadeForTests,
        runEnvironmentDefinitions: RunEnvironmentDefinitionsForTests,
        pipelineInitiatives: PipelineInitiativesForTests,
      }),
    ],
    moduleOverrides: [{ module: EngineModule, useModule: engineModule }],
  });
  const published: DomainEvent[] = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
  const tasks = app.get(StartedTasksForTests, { strict: false });
  tasks.announce = (event) => app.get(EventBus).publish(event);
  return {
    app,
    engine,
    tasks,
    records: app.get(TaskRecordsForTests, { strict: false }),
    people: app.get(KnownPeopleForTests, { strict: false }),
    projects: app.get(ProjectDefaultsForTests, { strict: false }),
    stageThreads: app.get(StageThreadsForTests, { strict: false }),
    threadMessages: app.get(StageThreadMessagesForTests, { strict: false }),
    decisions: app.get(StageDecisionsForTests, { strict: false }),
    git: app.get(TaskGitForTests, { strict: false }),
    commands: app.get(TaskCommandsForTests, { strict: false }),
    publishing: app.get(TaskPublishingForTests, { strict: false }),
    screenshots: app.get(TaskScreenshotsForTests, { strict: false }),
    usage: app.get(TaskUsageForTests, { strict: false }),
    contextLimitDefaults: app.get(StageContextLimitDefaultsForTests, { strict: false }),
    threadSessions: app.get(TaskThreadSessionsForTests, { strict: false }),
    roleEngines: app.get(StageRoleEnginesForTests, { strict: false }),
    cascade: app.get(RoleEngineCascadeForTests, { strict: false }),
    definitions: app.get(RunEnvironmentDefinitionsForTests, { strict: false }),
    initiatives: app.get(PipelineInitiativesForTests, { strict: false }),
    published,
  };
}

/** A started Task following `stages`, walked until its walk stops. */
export async function walkStages(
  { app, tasks }: PipelinesApplication,
  stages: readonly Stage[],
  taskId: string = randomUUID(),
): Promise<string> {
  await app.get(TaskStagesRepository, { strict: false }).save({
    taskId,
    pipelineId: "for-tests",
    stages,
    madeAt: new Date(),
    editedForTask: false,
    trace: undefined,
  });
  tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  const interpreter = app.get(StageInterpreter, { strict: false });
  interpreter.walkInBackground(taskId);
  await interpreter.walked(taskId);
  return taskId;
}

export function runsOf(
  { app }: PipelinesApplication,
  taskId: string,
): Promise<readonly StageRun[]> {
  return app.get(StageRunRepository, { strict: false }).list(taskId);
}

/** An Agent Stage of the Developer's, which asks for `Do <key>.` */
export function anAgentStage(
  key: string,
  fields: Partial<Extract<Stage, { kind: "agent" }>> = {},
): Stage {
  return {
    kind: "agent",
    key,
    name: key,
    optional: false,
    role: "developer",
    brief: `Do ${key}.`,
    session: "fresh",
    budget: 100_000,
    ...fields,
  };
}

/** A session's one turn, ending with `output` as its result. */
export function aTurn(output: unknown): SessionScript[number] {
  return {
    step: "event",
    event: {
      kind: "turn-ended",
      outcome: "completed",
      consumedMessageIds: [],
      usage: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
      sessionCostUsd: 0.01,
      output,
      errors: [],
    },
  };
}

/** An Agent Stage's session of one turn, which ends with `output`. */
export function anAgentSession(output: unknown): SessionScript {
  return [{ step: "start", brief: { id: "brief", text: "" } }, aTurn(output), { step: "end" }];
}

/** An Agent Stage's session whose first turn runs until The Office interrupts it. */
export const AN_INTERRUPTED_SESSION: SessionScript = [
  { step: "start", brief: { id: "brief", text: "" } },
  {
    step: "event",
    event: { kind: "text", text: "Editing the dialog.", withinToolCall: undefined },
  },
  { step: "interrupt" },
  {
    step: "event",
    event: {
      kind: "turn-ended",
      outcome: "interrupted",
      consumedMessageIds: [],
      usage: { input: 5, output: 40, cacheRead: 0, cacheCreation: 0 },
      sessionCostUsd: 0.01,
      output: undefined,
      errors: [],
    },
  },
  { step: "end" },
];

/**
 * A result that says the Stage is done, as an Agent Stage's session answers, reporting met the
 * Definition of Done statements `met` numbers: by default both of `aTaskRecord`'s.
 */
export function aDoneResult(
  summary = "Done.",
  handoverNote = "Nothing is left.",
  met: readonly number[] = [1, 2],
): Readonly<Record<string, unknown>> {
  return { status: "done", summary, handoverNote, definitionOfDoneMet: met };
}

/** The result of a turn in which the Agent opened a Decision with an Office tool. */
export const A_WAITING_RESULT: unknown = {
  status: "needs_decision",
  summary: "Asked which page.",
  handoverNote: "Waiting on the user.",
};

/** A Decision the Agent opens with an Office tool, as Conversations tells of it. */
export function anAskedDecision(fields: Partial<AskedDecision> = {}): AskedDecision {
  return {
    id: randomUUID(),
    question: "Which page?",
    context: "Both list devices.",
    options: ["The device page", "The list"],
    recommendation: { option: 0, reason: "It has the room." },
    ...fields,
  };
}

/** The Agent opens `asked` with an Office tool in the next Stage's first turn, and nothing after. */
export function asksOnce({ stageThreads }: PipelinesApplication, asked: AskedDecision): void {
  let opened = false;
  stageThreads.asksInTurn = () => {
    if (opened) return undefined;
    opened = true;
    return asked;
  };
}

/** Takes the user's answer to the Decision the Agent opened, and waits for the walk. */
export async function answerAsked(
  { app }: PipelinesApplication,
  taskId: string,
  asked: AskedDecision,
  answer: DecisionAnswer,
): Promise<void> {
  const interpreter = app.get(StageInterpreter, { strict: false });
  await interpreter.takeAnswer(taskId, asked.id, answer);
  await interpreter.walked(taskId);
}

/** Answers the walk's last Decision on the Task as the user would, and waits for the walk. */
export async function answerLastDecision(
  { app, decisions }: PipelinesApplication,
  taskId: string,
  answer: DecisionAnswer,
): Promise<void> {
  const decision = decisions.on(taskId).at(-1);
  if (!decision) throw new Error(`Task ${taskId} has no Decision to answer.`);
  const interpreter = app.get(StageInterpreter, { strict: false });
  await interpreter.takeAnswer(taskId, decision.id, answer);
  await interpreter.walked(taskId);
}
