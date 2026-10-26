import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import {
  EngineSessions,
  ScriptedEngine,
  ScriptedEngineModule,
  type SessionScript,
} from "../../engine/index.js";
import { TaskStarted } from "../../work/index.js";
import type { OnFailure, Stage } from "../domain/stage.js";
import type { StageOutcome } from "../domain/stage-run.js";
import {
  NoRetriesLeft,
  PipelineCompleted,
  StageRunEnded,
  StageRunStarted,
  WentBackToStage,
} from "../domain/stage-run-events.js";
import { PipelinesModule } from "../pipelines.module.js";
import {
  PipelinesPortsForTestsModule,
  StartedTasksForTests,
} from "../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";
import type { StageRunner, StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";

/**
 * An Agent Stage as a scripted session: its Brief is the Stage's brief and the error a loop carried
 * back, and its turn's output is the outcome. Task 12's step 3 is the real one.
 */
class ScriptedAgentStageRunner implements StageRunner<"agent"> {
  constructor(
    private readonly sessions: EngineSessions,
    private readonly folder: string,
  ) {}

  async run({ stage, run }: StageWork<"agent">): Promise<StageOutcome> {
    const brief = [stage.brief, run.carriedFailure?.error].filter(Boolean).join("\n\n");
    const session = await this.sessions.start({
      id: randomUUID(),
      settings: {
        folder: this.folder,
        environment: {},
        model: "scripted",
        effort: "low",
        instructions: "",
        skills: undefined,
        profile: { edit: true, run: { kind: "read-only-git" }, web: false },
        officeTools: [],
        outputSchema: { type: "object" },
      },
      brief: { id: randomUUID(), text: brief },
    });
    for await (const event of session.events) {
      if (event.kind === "turn-ended") {
        await session.end();
        return event.output as StageOutcome;
      }
    }
    throw new Error(`Session ${session.id} ended without a turn.`);
  }
}

/** A Script Stage that ends as the test says, in order. */
class ScriptStageRunnerForTests implements StageRunner<"script"> {
  readonly outcomes: StageOutcome[] = [];
  /** Runs while the Stage runs, such as dropping the Task meanwhile. */
  meanwhile: () => void = () => undefined;

  async run({ stage }: StageWork<"script">): Promise<StageOutcome> {
    this.meanwhile();
    const outcome = this.outcomes.shift();
    if (!outcome) throw new Error(`No outcome is left for Script Stage "${stage.key}".`);
    return outcome;
  }
}

function agentTurn(outcome: StageOutcome): SessionScript {
  return [
    { step: "start", brief: { id: "brief", text: "" } },
    {
      step: "event",
      event: {
        kind: "turn-ended",
        outcome: "completed",
        consumedMessageIds: ["brief"],
        usage: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
        sessionCostUsd: 0.01,
        output: outcome,
        errors: [],
      },
    },
    { step: "end" },
  ];
}

function agentStage(key: string, onFailure?: OnFailure): Stage {
  return {
    kind: "agent",
    key,
    name: key,
    optional: false,
    role: "developer",
    brief: `Do ${key}.`,
    session: "fresh",
    budget: 100_000,
    ...(onFailure && { onFailure }),
  };
}

function scriptStage(key: string, onFailure?: OnFailure): Stage {
  return {
    kind: "script",
    key,
    name: key,
    optional: false,
    command: "test",
    ...(onFailure && { onFailure }),
  };
}

const done: StageOutcome = { status: "done", summary: "Done." };

let app: INestApplication;
let folder: string;
let engine: ScriptedEngine;
let tasks: StartedTasksForTests;
let scriptRunner: ScriptStageRunnerForTests;
let published: DomainEvent[];

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-stage-interpreter-"));
});

afterEach(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

/** The Pipelines module, its Agent Stages' sessions replaying `scripts` in order. */
async function startWith(...scripts: SessionScript[]): Promise<void> {
  await startWithoutRunners(scripts);
  scriptRunner = new ScriptStageRunnerForTests();
  const runners = app.get(StageRunners);
  runners.register("agent", new ScriptedAgentStageRunner(app.get(EngineSessions), folder));
  runners.register("script", scriptRunner);
}

/** The Pipelines module as production has it until each kind's runner comes. */
async function startWithoutRunners(scripts: readonly SessionScript[] = []): Promise<void> {
  engine = new ScriptedEngine(scripts);
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      TelemetryModule,
      ScriptedEngineModule.register(engine),
      PipelinesModule.register({
        imports: [PipelinesPortsForTestsModule],
        startedTasks: StartedTasksForTests,
      }),
    ],
  }));
  tasks = app.get(StartedTasksForTests);
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
}

/** A started Task following `stages`, walked until its walk stops. */
async function walk(stages: readonly Stage[], taskId: string = randomUUID()): Promise<string> {
  await app
    .get(TaskStagesRepository)
    .saveNew({ taskId, pipelineId: "for-tests", stages, startedAt: new Date() });
  tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  const interpreter = app.get(StageInterpreter);
  interpreter.walkInBackground(taskId);
  await interpreter.walked(taskId);
  return taskId;
}

async function runsOf(taskId: string): Promise<[string, string | undefined][]> {
  const runs = await app.get(StageRunRepository).list(taskId);
  return runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status]);
}

/** What the walk announced, as each event's class and the fields that tell them apart. */
function walkEvents(): unknown[] {
  return published.flatMap((event) => {
    if (event instanceof StageRunStarted) return [["started", event.stageKey]];
    if (event instanceof StageRunEnded) return [["ended", event.stageKey, event.status]];
    if (event instanceof WentBackToStage) {
      return [["went back", event.fromStageKey, event.toStageKey, event.round, event.rounds]];
    }
    if (event instanceof NoRetriesLeft) return [["no retries left", event.stageKey, event.error]];
    if (event instanceof PipelineCompleted) return [["completed"]];
    return [];
  });
}

describe("StageInterpreter", () => {
  it("walks a Pipeline of arbitrary Stages to the end and the Task to Done", async () => {
    await startWith(agentTurn(done), agentTurn(done));
    scriptRunner.outcomes.push(done);

    const taskId = await walk([agentStage("draft"), scriptStage("measure"), agentStage("proof")]);

    expect(await runsOf(taskId)).toEqual([
      ["draft", "done"],
      ["measure", "done"],
      ["proof", "done"],
    ]);
    expect(walkEvents()).toEqual([
      ["started", "draft"],
      ["ended", "draft", "done"],
      ["started", "measure"],
      ["ended", "measure", "done"],
      ["started", "proof"],
      ["ended", "proof", "done"],
      ["completed"],
    ]);
    expect(tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("goes back on failure, with the error in the next Brief, as many times as the loop may", async () => {
    await startWith(agentTurn(done), agentTurn(done), agentTurn(done));
    scriptRunner.outcomes.push(
      { status: "failed", error: "2 tests fail." },
      { status: "failed", error: "1 test fails." },
      done,
    );

    const taskId = await walk([
      agentStage("draft"),
      scriptStage("measure", { goBackTo: "draft", rounds: 2 }),
    ]);

    expect(await runsOf(taskId)).toEqual([
      ["draft", "done"],
      ["measure", "failed"],
      ["draft", "done"],
      ["measure", "failed"],
      ["draft", "done"],
      ["measure", "done"],
    ]);
    const briefs = engine.sessions.map(({ received }) => {
      const [opening] = received;
      return opening?.step === "start" ? opening.brief.text : undefined;
    });
    expect(briefs).toEqual([
      "Do draft.",
      "Do draft.\n\n2 tests fail.",
      "Do draft.\n\n1 test fails.",
    ]);
    expect(walkEvents()).toContainEqual(["went back", "measure", "draft", 2, 2]);
    const runs = await app.get(StageRunRepository).list(taskId);
    expect(runs[2]?.carriedFailure).toEqual({
      stageKey: "measure",
      error: "2 tests fail.",
      round: 1,
      rounds: 2,
    });
    expect(tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("stops with no retries left and the Task waits on the user", async () => {
    await startWith(agentTurn(done), agentTurn(done));
    scriptRunner.outcomes.push(
      { status: "failed", error: "2 tests fail." },
      { status: "failed", error: "Still 2." },
    );

    const taskId = await walk([
      agentStage("draft"),
      scriptStage("measure", { goBackTo: "draft", rounds: 1 }),
    ]);

    expect(await runsOf(taskId)).toHaveLength(4);
    expect(walkEvents().slice(-2)).toEqual([
      ["ended", "measure", "failed"],
      ["no retries left", "measure", "Still 2."],
    ]);
    expect(tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
  });

  it("stops at a failed Stage without a loop", async () => {
    await startWith(agentTurn({ status: "failed", error: "The page isn't there." }));

    const taskId = await walk([agentStage("draft"), scriptStage("measure")]);

    expect(await runsOf(taskId)).toEqual([["draft", "failed"]]);
    expect(walkEvents()).toContainEqual(["no retries left", "draft", "The page isn't there."]);
    expect(tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
  });

  it("waits on the user when a Stage needs a Decision", async () => {
    await startWith(agentTurn({ status: "needs-decision", question: "Which page?" }));

    const taskId = await walk([agentStage("draft"), scriptStage("measure")]);

    expect(await runsOf(taskId)).toEqual([["draft", "needs-decision"]]);
    expect(tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
    expect(walkEvents()).not.toContainEqual(expect.arrayContaining(["no retries left"]));
  });

  it("fails a Stage of a kind it can't run yet, with the reason", async () => {
    await startWithoutRunners();
    const taskId = await walk([agentStage("draft")]);

    expect(walkEvents()).toEqual([
      ["started", "draft"],
      ["ended", "draft", "failed"],
      ["no retries left", "draft", "The Office can't run this Agent Stage yet."],
    ]);
    expect(tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
  });

  it("stops where the runs stand once the Task is no longer In progress", async () => {
    await startWith();
    const taskId = randomUUID();
    scriptRunner.outcomes.push(done);
    scriptRunner.meanwhile = () => tasks.put(taskId, { state: "dropped", pipelineId: "for-tests" });

    await walk([scriptStage("measure"), agentStage("draft")], taskId);

    expect(await runsOf(taskId)).toEqual([["measure", "done"]]);
    expect(tasks.changes).toEqual([]);
  });

  it("walks a Task as it starts, on its own copy of its Pipeline's Stages", async () => {
    await startWith(agentTurn(done));
    scriptRunner.outcomes.push(done, done);
    const taskId = randomUUID();
    tasks.put(taskId, { state: "in-progress", pipelineId: "quick-fix" });

    await app.get(EventBus).publish(new TaskStarted(taskId, "quick-fix"));
    await app.get(StageInterpreter).walked(taskId);

    expect(await app.get(TaskStagesRepository).find(taskId)).toMatchObject({
      pipelineId: "quick-fix",
    });
    expect(await runsOf(taskId)).toEqual([
      ["implement", "done"],
      ["tests", "done"],
      ["publish", "done"],
    ]);
    expect(tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("makes the Task's own Stages when the copy made as it started is missing", async () => {
    await startWith(agentTurn({ status: "failed", error: "Stopped here." }));
    const taskId = randomUUID();
    tasks.put(taskId, { state: "in-progress", pipelineId: "quick-fix" });

    app.get(StageInterpreter).walkInBackground(taskId);
    await app.get(StageInterpreter).walked(taskId);

    expect(await app.get(TaskStagesRepository).find(taskId)).toMatchObject({
      pipelineId: "quick-fix",
    });
    expect(await runsOf(taskId)).toEqual([["implement", "failed"]]);
  });

  it("starts no other Stage once the service stops", async () => {
    await startWith();
    scriptRunner.outcomes.push(done);
    const interpreter = app.get(StageInterpreter);
    scriptRunner.meanwhile = () => void interpreter.onModuleDestroy();

    const taskId = await walk([scriptStage("measure"), scriptStage("lint")]);

    expect(await runsOf(taskId)).toEqual([["measure", "done"]]);
    expect(tasks.changes).toEqual([]);
  });
});
