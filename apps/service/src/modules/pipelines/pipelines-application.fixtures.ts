import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { startTestApplication } from "../../../test/test-application.js";
import type { DomainEvent } from "../../platform/events/domain-event.js";
import { EventBus } from "../../platform/events/event-bus.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { TelemetryModule } from "../../platform/telemetry/telemetry.module.js";
import {
  ScriptedEngine,
  ScriptedEngineModule,
  type SessionScript,
  type StandInEngine,
} from "../engine/index.js";
import { StageInterpreter } from "./application/stage-interpreter.js";
import type { Stage } from "./domain/stage.js";
import type { StageRun } from "./domain/stage-run.js";
import { PipelinesModule } from "./pipelines.module.js";
import {
  KnownPeopleForTests,
  PipelinesPortsForTestsModule,
  StageThreadsForTests,
  StartedTasksForTests,
  TaskGitForTests,
  TaskRecordsForTests,
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
  readonly stageThreads: StageThreadsForTests;
  readonly git: TaskGitForTests;
  readonly published: DomainEvent[];
}

/**
 * Agent Stages' sessions replay `scripts` in order, one per Stage, each with a real `standIn`
 * engine process when a test gives one.
 */
export async function startPipelinesApplication(
  scripts: readonly SessionScript[] = [],
  standIn?: StandInEngine,
): Promise<PipelinesApplication> {
  const engine = new ScriptedEngine(scripts, {}, standIn);
  const engineModule = ScriptedEngineModule.register(engine);
  const { app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      TelemetryModule,
      engineModule,
      PipelinesModule.register({
        imports: [PipelinesPortsForTestsModule.register([engineModule])],
        startedTasks: StartedTasksForTests,
        taskRecords: TaskRecordsForTests,
        knownPeople: KnownPeopleForTests,
        stageThreads: StageThreadsForTests,
        taskGit: TaskGitForTests,
      }),
    ],
  });
  const published: DomainEvent[] = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
  return {
    app,
    engine,
    tasks: app.get(StartedTasksForTests, { strict: false }),
    records: app.get(TaskRecordsForTests, { strict: false }),
    people: app.get(KnownPeopleForTests, { strict: false }),
    stageThreads: app.get(StageThreadsForTests, { strict: false }),
    git: app.get(TaskGitForTests, { strict: false }),
    published,
  };
}

/** A started Task following `stages`, walked until its walk stops. */
export async function walkStages(
  { app, tasks }: PipelinesApplication,
  stages: readonly Stage[],
  taskId: string = randomUUID(),
): Promise<string> {
  await app
    .get(TaskStagesRepository, { strict: false })
    .saveNew({ taskId, pipelineId: "for-tests", stages, startedAt: new Date() });
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

/** A result that says the Stage is done, as an Agent Stage's session answers. */
export function aDoneResult(summary = "Done.", handoverNote = "Nothing is left."): unknown {
  return { status: "done", summary, handoverNote };
}
