import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { interruptedOutcome } from "../../domain/stage-interruption.js";
import {
  endStageRun,
  holdStageRun,
  keepAnswers,
  keepDecision,
  keepGateAction,
} from "../../domain/stage-run-changes.js";
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";
import { aStageRun } from "../../domain/stage-run.fixtures.js";
import type { StageOutcome, StageRun, StageRunDecision } from "../../domain/stage-run.js";
import { PostgresStageRunRepository } from "./postgres-stage-run-repository.js";
import { PostgresTaskStagesRepository } from "./postgres-task-stages-repository.js";

let app: INestApplication;
let runs: PostgresStageRunRepository;
let taskStages: PostgresTaskStagesRepository;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresStageRunRepository, PostgresTaskStagesRepository],
  }));
  runs = app.get(PostgresStageRunRepository);
  taskStages = app.get(PostgresTaskStagesRepository);
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

function thisWeek(hour: number): Date {
  return new Date(Date.UTC(2099, 2, 2, hour));
}

async function runOf(taskId: string): Promise<StageRun | undefined> {
  return (await runs.list(taskId))[0];
}

function ended(run: StageRun, outcome: StageOutcome) {
  return runs.update(run.id, (held) => endStageRun(held, outcome, new Date()));
}

describe("PostgresStageRunRepository's changed files", () => {
  it("keeps where the run left the branch with the files its commit changed", async () => {
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    await runs.saveNew(run);
    const changedFiles = ["src/old-name.ts", "src/new-name.ts", "README.md"];

    await runs.saveLeftBranch(run.id, { headCommit: "c".repeat(40), changedFiles });
    await ended(run, { status: "done", summary: "Done." });

    expect(await runOf(run.taskId)).toMatchObject({ headCommit: "c".repeat(40), changedFiles });
  });

  it("keeps none for a run that committed nothing, and for one that ended with none saved", async () => {
    const leftAsFound = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    const gate = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    await runs.saveNew(leftAsFound);
    await runs.saveNew(gate);

    await runs.saveLeftBranch(leftAsFound.id, { headCommit: "a".repeat(40), changedFiles: [] });
    expect((await runOf(gate.taskId))?.changedFiles).toBeUndefined();
    await ended(gate, { status: "done", summary: "Approved." });

    expect((await runOf(leftAsFound.taskId))?.changedFiles).toEqual([]);
    expect((await runOf(gate.taskId))?.changedFiles).toEqual([]);
  });

  it("reads a run the previous release wrote, without the column, as not recorded", async () => {
    const taskId = randomUUID();
    await database.execute(
      sql`INSERT INTO "stage_runs" ("id", "task_id", "stage_key", "number", "head_commit", "outcome", "started_at", "ended_at")
        VALUES (${randomUUID()}, ${taskId}, 'implement', 1, ${"b".repeat(40)}, '{"status":"done","summary":"Done."}'::jsonb, now(), now())`,
    );

    const run = await runOf(taskId);

    expect(run?.headCommit).toBe("b".repeat(40));
    expect(run?.changedFiles).toBeUndefined();
  });
});

describe("PostgresStageRunRepository's hold", () => {
  const BEN_ITO = { userId: randomUUID(), name: "Ben Ito" };
  const ANN_LEE = { userId: randomUUID(), name: "Ann Lee" };

  it("keeps what a run a Stop ended honoured when the walk saved nothing asked of it first", async () => {
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    await runs.saveNew(run);

    await ended(run, interruptedOutcome("stop", [], { heldByUser: BEN_ITO }));

    expect(await runOf(run.taskId)).toMatchObject({ heldBy: "stop", heldByUser: BEN_ITO });
  });

  it("keeps what the walk saved was asked of the run over a weaker hold its end honoured", async () => {
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    await runs.saveNew(run);

    await runs.update(run.id, (held) => holdStageRun(held, "stop", BEN_ITO));
    // The end reads the run as stored, not the copy the walk started it from.
    await ended(run, interruptedOutcome("pause", [], { heldByUser: ANN_LEE }));

    expect(await runOf(run.taskId)).toMatchObject({ heldBy: "stop", heldByUser: BEN_ITO });
  });

  it("keeps the Stop of a Pause and a Stop asked at once, whichever is saved first", async () => {
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    await runs.saveNew(run);

    await Promise.all([
      runs.update(run.id, (held) => holdStageRun(held, "pause", ANN_LEE)),
      runs.update(run.id, (held) => holdStageRun(held, "stop", BEN_ITO)),
      runs.update(run.id, (held) => holdStageRun(held, "pause", ANN_LEE)),
    ]);
    await ended(run, interruptedOutcome("stop", [], { heldByUser: BEN_ITO }));

    expect(await runOf(run.taskId)).toMatchObject({ heldBy: "stop", heldByUser: BEN_ITO });
  });

  it("holds an ended run no more", async () => {
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    await runs.saveNew(run);
    await ended(run, { status: "done", summary: "Done." });

    const held = await runs.update(run.id, (stored) => holdStageRun(stored, "stop", BEN_ITO));

    expect(held).toBeUndefined();
    expect(await runOf(run.taskId)).toMatchObject({ heldBy: undefined, heldByUser: undefined });
  });

  it("keeps none for a run that ended without being held", async () => {
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    await runs.saveNew(run);

    await ended(run, { status: "done", summary: "Done." });

    expect(await runOf(run.taskId)).toMatchObject({ heldBy: undefined, heldByUser: undefined });
  });

  it("ends a run once: a second end is refused and changes nothing", async () => {
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    await runs.saveNew(run);
    await ended(run, { status: "done", summary: "Done." });

    await expect(ended(run, { status: "failed", error: "Too late." })).rejects.toThrow(
      "has already ended done",
    );
    expect((await runOf(run.taskId))?.outcome).toEqual({ status: "done", summary: "Done." });
  });
});

function walkDecisionOf(id: string): StageRunDecision {
  return { id, kind: "route-limit", options: [{ kind: "drop" }], answer: undefined };
}

function agentDecisionOf(id: string): StageRunDecision {
  const options = [{ kind: "answered", answer: "Yes" } as const];
  return { id, kind: "agent", question: "Go on?", options, answer: undefined };
}

describe("PostgresStageRunRepository's Decisions", () => {
  it("keeps every Decision kept on the run at once", async () => {
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID() });
    await runs.saveNew(run);
    const ids = Array.from({ length: 8 }, () => randomUUID());

    await Promise.all(
      ids.map((id) => runs.update(run.id, (held) => keepDecision(held, agentDecisionOf(id)))),
    );

    expect((await runOf(run.taskId))?.decisions.map(({ id }) => id).toSorted()).toEqual(
      ids.toSorted(),
    );
  });

  it("keeps an answer given while another Decision is kept on the run", async () => {
    const answered = walkDecisionOf(randomUUID());
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID(), decisions: [answered] });
    await runs.saveNew(run);
    const asked = agentDecisionOf(randomUUID());

    await Promise.all([
      runs.update(run.id, (held) => keepDecision(held, asked)),
      runs.update(run.id, (held) =>
        keepAnswers(held, new Map([[answered.id, { kind: "option", option: 0 }]])),
      ),
    ]);

    expect((await runOf(run.taskId))?.decisions).toEqual(
      expect.arrayContaining([{ ...answered, answer: { kind: "drop" } }, asked]),
    );
  });

  it("takes one answer of a Decision answered twice at once", async () => {
    const decision = agentDecisionOf(randomUUID());
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID(), decisions: [decision] });
    await runs.saveNew(run);

    const taken = await Promise.all(
      ["first", "second"].map((text) =>
        runs.update(run.id, (held) =>
          keepAnswers(held, new Map([[decision.id, { kind: "free-answer", text }]])),
        ),
      ),
    );

    const kept = taken.filter((change) => change !== undefined);
    expect(kept).toHaveLength(1);
    expect((await runOf(run.taskId))?.decisions).toEqual(kept[0]?.run.decisions);
  });
});

describe("PostgresStageRunRepository's update", () => {
  it("refuses a run there is none of", async () => {
    await expect(
      runs.update(randomUUID(), (run) => holdStageRun(run, "pause", undefined)),
    ).rejects.toThrow("There is no Stage run");
  });

  it("takes one Gate action of two at once", async () => {
    const gate = aStageRun({ id: randomUUID(), taskId: randomUUID(), stageKey: "approve" });
    await runs.saveNew(gate);
    const byUser = { userId: randomUUID(), name: "Ann Lee" };

    const taken = await Promise.all([
      runs.update(gate.id, (run) => keepGateAction(run, { kind: "continue", byUser })),
      runs.update(gate.id, (run) => keepGateAction(run, { kind: "drop", byUser })),
    ]);

    expect(taken.filter((change) => change !== undefined)).toHaveLength(1);
    const kept = taken.find((change) => change !== undefined)?.run.gateAction;
    expect((await runOf(gate.taskId))?.gateAction).toEqual(kept);
  });
});

describe("PostgresStageRunRepository's engine", () => {
  it("keeps the engine the run ran on with the cascade's engine it stood in for, and none on the cascade's own", async () => {
    const standingIn = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    const onItsOwn = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    await runs.saveNew(standingIn);
    await runs.saveNew(onItsOwn);
    const standInFor = { engineId: "work", engineName: "Work", reason: "Work's window is near." };

    await runs.saveThread(standingIn.id, {
      threadId: randomUUID(),
      session: "fresh",
      engineId: "personal",
      engineName: "Personal",
      model: "claude-opus-5-5",
      standInFor,
    });
    await runs.saveThread(onItsOwn.id, {
      threadId: randomUUID(),
      session: "fresh",
      engineId: "work",
      engineName: "Work",
      model: "claude-opus-5-5",
      standInFor: undefined,
    });

    expect(await runOf(standingIn.taskId)).toMatchObject({
      engineId: "personal",
      engineName: "Personal",
      model: "claude-opus-5-5",
      standInFor,
    });
    expect(await runOf(onItsOwn.taskId)).toMatchObject({ engineId: "work" });
    expect((await runOf(onItsOwn.taskId))?.standInFor).toBeUndefined();
  });

  it("reads a run kept before stand-ins were recorded as on the cascade's own engine", async () => {
    const taskId = randomUUID();
    await database.execute(
      sql`INSERT INTO "stage_runs" ("id", "task_id", "stage_key", "number", "engine_id", "model", "started_at")
        VALUES (${randomUUID()}, ${taskId}, 'implement', 1, 'claude-code', 'scripted', now())`,
    );

    expect((await runOf(taskId))?.standInFor).toBeUndefined();
  });

  it("appends each switch to a Stand-in Engine in order, with the engine the session runs on now", async () => {
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID(), outcome: undefined });
    await runs.saveNew(run);
    expect((await runOf(run.taskId))?.engineSwitches).toEqual([]);
    const toPersonal = {
      fromEngineId: "work",
      fromEngineName: "Work",
      toEngineId: "personal",
      toEngineName: "Personal",
      windowWords: "5-hour window",
      resetsAt: "2026-11-13T14:00:00.000Z",
      at: "2026-11-13T12:00:00.000Z",
    };
    const toSpare = {
      ...toPersonal,
      fromEngineId: "personal",
      fromEngineName: "Personal",
      toEngineId: "spare",
      toEngineName: "Spare",
      at: "2026-11-13T12:30:00.000Z",
    };
    const standInFor = { engineId: "work", engineName: "Work", reason: "Its window was used up." };

    await runs.saveEngineSwitch(run.id, toPersonal, {
      engineId: "personal",
      engineName: "Personal",
      standInFor,
    });
    await runs.saveEngineSwitch(run.id, toSpare, {
      engineId: "spare",
      engineName: "Spare",
      standInFor,
    });

    expect(await runOf(run.taskId)).toMatchObject({
      engineId: "spare",
      engineName: "Spare",
      standInFor,
      engineSwitches: [toPersonal, toSpare],
    });
  });

  it("reads a run kept before switches were recorded as having none", async () => {
    const taskId = randomUUID();
    await database.execute(
      sql`INSERT INTO "stage_runs" ("id", "task_id", "stage_key", "number", "started_at")
        VALUES (${randomUUID()}, ${taskId}, 'implement', 1, now())`,
    );

    expect((await runOf(taskId))?.engineSwitches).toEqual([]);
  });
});

describe("PostgresStageRunRepository.enginesOfTasks", () => {
  it("gives each run of the Tasks named that ran on an engine, by number, with the engine it stood in for and its switches", async () => {
    const taskId = randomUUID();
    const other = randomUUID();
    const first = aStageRun({ id: randomUUID(), taskId, number: 1 });
    const retry = aStageRun({ id: randomUUID(), taskId, number: 2, outcome: undefined });
    const notStarted = aStageRun({ id: randomUUID(), taskId, number: 3, outcome: undefined });
    const otherTask = aStageRun({ id: randomUUID(), taskId: other, number: 1 });
    for (const run of [first, retry, notStarted, otherTask]) await runs.saveNew(run);
    const thread = { threadId: randomUUID(), session: "fresh", model: "claude-opus-5-5" } as const;
    await runs.saveThread(first.id, {
      ...thread,
      engineId: "work",
      engineName: "Work",
      standInFor: undefined,
    });
    const standInFor = { engineId: "work", engineName: "Work", reason: "Its window was used up." };
    await runs.saveThread(retry.id, {
      ...thread,
      engineId: "work",
      engineName: "Work",
      standInFor: undefined,
    });
    const toPersonal = {
      fromEngineId: "work",
      fromEngineName: "Work",
      toEngineId: "personal",
      toEngineName: "Personal",
      windowWords: "5-hour window",
      resetsAt: "2026-11-13T14:00:00.000Z",
      at: "2026-11-13T12:00:00.000Z",
    };
    await runs.saveEngineSwitch(retry.id, toPersonal, {
      engineId: "personal",
      engineName: "Personal",
      standInFor,
    });
    await runs.saveThread(otherTask.id, {
      ...thread,
      engineId: "spare",
      engineName: "Spare",
      standInFor: undefined,
    });

    expect(await runs.enginesOfTasks([taskId])).toEqual([
      {
        taskId,
        number: 1,
        engineId: "work",
        engineName: "Work",
        standInFor: undefined,
        switches: [],
      },
      {
        taskId,
        number: 2,
        engineId: "personal",
        engineName: "Personal",
        standInFor: { engineId: "work", engineName: "Work" },
        switches: [toPersonal],
      },
    ]);
    expect(await runs.enginesOfTasks([])).toEqual([]);
  });
});

function commandRun(commandLine: string, wholeOutput: string) {
  return {
    purpose: "command" as const,
    commandLine,
    outcome: "passed" as const,
    exitCode: 0,
    durationMs: 1000,
    output: `${wholeOutput} (cut)`,
    wholeOutput,
  };
}

describe("PostgresStageRunRepository.addCommandRuns", () => {
  const condition = { key: "lint", to: "review", routeIndex: 0, testPath: [0] };

  it("adds the runs after those saved before, each whole output at its run's place", async () => {
    const run = aStageRun({ id: randomUUID(), taskId: randomUUID() });
    await runs.saveNew(run);
    await runs.saveCommandRuns(run.id, [commandRun("npm test", "All passed.")]);

    await runs.addCommandRuns(run.id, [
      { ...commandRun("npm run lint", "No problems."), purpose: "condition", condition },
    ]);

    expect((await runOf(run.taskId))?.commandRuns).toMatchObject([
      { purpose: "command", commandLine: "npm test" },
      { purpose: "condition", commandLine: "npm run lint", condition },
    ]);
    expect(await runs.commandOutputs(run.taskId, run.id)).toEqual(["All passed.", "No problems."]);
  });

  it("keeps a run saved before whole outputs were kept readable, its filtered outputs in their place", async () => {
    const taskId = randomUUID();
    const id = randomUUID();
    await database.execute(
      sql`INSERT INTO "stage_runs" ("id", "task_id", "stage_key", "number", "command_runs", "outcome", "started_at", "ended_at")
        VALUES (${id}, ${taskId}, 'tests', 1, '[{"purpose":"command","commandLine":"npm test","outcome":"passed","exitCode":0,"durationMs":1,"output":"Old output."}]'::jsonb, '{"status":"done","summary":"Done."}'::jsonb, now(), now())`,
    );

    await runs.addCommandRuns(id, [
      { ...commandRun("npm run lint", "No problems."), purpose: "condition", condition },
    ]);

    expect(await runs.commandOutputs(taskId, id)).toEqual(["Old output.", "No problems."]);
  });
});

describe("PostgresStageRunRepository.startedSince", () => {
  it("gives each run started since with its tokens, a retry this week of a Stage first run last week counted as a retry", async () => {
    // Tests share the database, so only this test's own Tasks are looked at, far in the future.
    const since = new Date("2099-03-02T00:00:00.000Z");
    const lastWeek = new Date("2099-02-27T10:00:00.000Z");
    const [oneTask, otherTask] = [randomUUID(), randomUUID()];
    const tokens = { input: 10, output: 20, cacheRead: 1_000, cacheCreation: 5 };
    const saved = async (taskId: string, number: number, fields: Partial<StageRun>) =>
      runs.saveNew(aStageRun({ id: randomUUID(), taskId, number, ...fields }));
    await saved(oneTask, 1, { stageKey: "implement", startedAt: lastWeek });
    await saved(oneTask, 2, { stageKey: "implement", startedAt: thisWeek(8), tokens });
    await saved(oneTask, 3, { stageKey: "review", startedAt: thisWeek(9) });
    await saved(otherTask, 1, { stageKey: "implement", startedAt: since });
    const ours = new Set<string>([oneTask, otherTask]);

    const started = (await runs.startedSince(since)).filter(({ taskId }) => ours.has(taskId));

    expect(started).toHaveLength(3);
    expect(started).toEqual(
      expect.arrayContaining([
        { taskId: oneTask, tokens, retry: true },
        {
          taskId: oneTask,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          retry: false,
        },
        {
          taskId: otherTask,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          retry: false,
        },
      ]),
    );
  });
});

function at(hour: number): Date {
  return new Date(Date.UTC(2099, 5, 1, hour));
}

describe("PostgresStageRunRepository.ranBetween", () => {
  it("gives each Agent Stage run that overlapped the range, oldest first, with its engine and its Stage's name", async () => {
    // Tests share the database, so only this test's own Tasks are looked at, far in the future.
    const [oneTask, otherTask] = [randomUUID(), randomUUID()];
    await taskStages.save({
      taskId: oneTask,
      pipelineId: "full",
      stages: [agentStage(), agentStage({ key: "review", name: "Review & fix" }), scriptStage()],
      madeAt: at(0),
      editedForTask: false,
      trace: undefined,
    });
    const saved = async (taskId: string, number: number, fields: Partial<StageRun>) =>
      runs.saveNew(
        aStageRun({ id: randomUUID(), taskId, number, engineId: "claude-code", ...fields }),
      );
    await saved(oneTask, 1, { startedAt: at(1), endedAt: at(9) }); // ended before the range
    await saved(oneTask, 2, { stageKey: "review", startedAt: at(9), endedAt: at(11) });
    await saved(oneTask, 3, { stageKey: "tests", engineId: undefined, startedAt: at(11) });
    await saved(oneTask, 4, { startedAt: at(12), endedAt: undefined, outcome: undefined });
    await saved(oneTask, 5, { startedAt: at(14), endedAt: at(15) }); // starts at the range's end
    await saved(otherTask, 1, { stageKey: "gone", startedAt: at(8), endedAt: at(20) });
    const ours = new Set<string>([oneTask, otherTask]);

    const ran = (await runs.ranBetween(at(10), at(14))).filter(({ taskId }) => ours.has(taskId));

    expect(ran).toEqual([
      {
        engineId: "claude-code",
        taskId: otherTask,
        stageName: "gone",
        startedAt: at(8),
        endedAt: at(20),
      },
      {
        engineId: "claude-code",
        taskId: oneTask,
        stageName: "Review & fix",
        startedAt: at(9),
        endedAt: at(11),
      },
      {
        engineId: "claude-code",
        taskId: oneTask,
        stageName: "Implement",
        startedAt: at(12),
        endedAt: undefined,
      },
    ]);
  });
});
