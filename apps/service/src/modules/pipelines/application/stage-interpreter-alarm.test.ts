import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { AlarmSounded, TaskResumed } from "../../work/index.js";
import {
  AN_INTERRUPTED_SESSION,
  aDoneResult,
  anAgentSession,
  anAgentStage,
  anAskedDecision,
  answerAsked,
  asksOnce,
  A_WAITING_RESULT,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import type { Stage } from "../domain/stage.js";
import { startStageRun } from "../domain/stage-run-changes.js";
import { PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { AlarmResumes } from "./alarm-resumes.js";
import { GateService } from "./gate-service.js";
import { StageInterpreter } from "./stage-interpreter.js";

const implement = anAgentStage("implement", { name: "Implement" });
const review = anAgentStage("review", { name: "Review & fix" });
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};
const gate: Stage = { kind: "gate", key: "look", name: "Look", optional: false };

const HELD =
  "Held by the fire alarm. The Stage's uncommitted edits stay in the worktree for it to go on with after the all clear.";

const open = new Set<PipelinesApplication>();

afterEach(async () => {
  await Promise.all(
    [...open].map((pipelines) => {
      open.delete(pipelines);
      return pipelines.app.close();
    }),
  );
});

async function start(scripts: Parameters<typeof startPipelinesApplication>[0] = []) {
  const pipelines = await startPipelinesApplication(scripts);
  open.add(pipelines);
  return pipelines;
}

function scheduleOf({ app }: PipelinesApplication): ManualSchedule {
  return app.get(Schedule, { strict: false }) as ManualSchedule;
}

/** The user sounds the alarm, as Work announces it: each running Task paused by it, then AlarmSounded. */
async function soundTheAlarm(pipelines: PipelinesApplication, taskId: string): Promise<void> {
  const since = scheduleOf(pipelines).now();
  pipelines.tasks.fireAlarmOn = true;
  await pipelines.tasks.pauseForAlarm(taskId);
  await pipelines.app
    .get(EventBus)
    .publish(new AlarmSounded(since, new Date(since.getTime() + 60_000)));
}

/** Runs `action` once, as the first Stage's first turn runs, which waits for it. */
function whileTheFirstTurnRuns(pipelines: PipelinesApplication, action: () => Promise<void>): void {
  pipelines.stageThreads.whileTurnRuns = () => {
    pipelines.stageThreads.whileTurnRuns = undefined;
    return action();
  };
}

/** The Task resumed, as the all clear will resume it through Work, waiting for the walk. */
async function resume(pipelines: PipelinesApplication, taskId: string): Promise<void> {
  pipelines.tasks.fireAlarmOn = false;
  pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
  await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);
}

async function statusesOf(
  pipelines: PipelinesApplication,
  taskId: string,
): Promise<[string, string | undefined][]> {
  return (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
    stageKey,
    outcome?.status,
  ]);
}

describe("Sounding the fire alarm", () => {
  it("holds an Agent Stage once its turn ends, its edits kept, and the Stage goes on with them after", async () => {
    const pipelines = await start([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts"]);
    whileTheFirstTurnRuns(pipelines, () => soundTheAlarm(pipelines, taskId));

    await walkStages(pipelines, [implement, review], taskId);

    const [held, ...more] = await runsOf(pipelines, taskId);
    expect(held?.outcome).toEqual({ status: "failed", error: HELD, interrupted: "alarm" });
    expect(held?.headCommit).toBe(PLANNED_COMMIT);
    expect(more).toEqual([]);
    expect(pipelines.stageThreads.interrupted).toEqual([]);
    expect(pipelines.stageThreads.ended.at(-1)?.closing).toEqual({
      kind: "held",
      heldBy: "alarm",
      text: HELD,
    });
    expect(pipelines.git.discarded).toEqual([]);
    expect(pipelines.git.commits).toEqual([]);
    expect(await pipelines.tasks.read(taskId)).toMatchObject({
      state: "paused",
      pausedByAlarm: true,
    });

    await resume(pipelines, taskId);

    expect(pipelines.stageThreads.requests[1]?.work).toContain(
      "## Held by the fire alarm\n\nThe user sounded the fire alarm while this Stage ran",
    );
    expect(await statusesOf(pipelines, taskId)).toEqual([
      ["implement", "failed"],
      ["implement", "done"],
      ["review", "done"],
    ]);
  });

  it("cuts a turn still running short at the hard stop, 60 s on, keeping its edits", async () => {
    const pipelines = await start([AN_INTERRUPTED_SESSION]);
    const taskId = randomUUID();
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts"]);
    const schedule = scheduleOf(pipelines);
    schedule.setTime(new Date("2026-10-29T09:00:00.000Z"));
    whileTheFirstTurnRuns(pipelines, async () => {
      await soundTheAlarm(pipelines, taskId);
      await schedule.advanceTo(new Date("2026-10-29T09:00:59.000Z"));
      expect(pipelines.stageThreads.interrupted).toEqual([]);
      await schedule.advanceTo(new Date("2026-10-29T09:01:00.000Z"));
    });

    await walkStages(pipelines, [implement], taskId);

    const [run] = await runsOf(pipelines, taskId);
    expect(pipelines.stageThreads.interrupted).toEqual([run?.threadId]);
    expect(run?.outcome).toEqual({
      status: "failed",
      error:
        "Held by the fire alarm. Its hard stop cut the Agent's last turn short: the Stage's uncommitted edits stay in the worktree, maybe half-done, for it to go on with.",
      interrupted: "alarm",
      cutShort: true,
    });
    expect(pipelines.git.discarded).toEqual([]);
  });

  it("stops a Script Stage's command at once, its Stage to run again from its start", async () => {
    const pipelines = await start();
    const taskId = randomUUID();
    pipelines.commands.runsUntilStopped = true;
    pipelines.commands.observe = (call) => {
      if (call === "runCommand") void soundTheAlarm(pipelines, taskId);
    };

    await walkStages(pipelines, [tests, review], taskId);

    expect(await runsOf(pipelines, taskId)).toMatchObject([
      { stageKey: "tests", outcome: { status: "failed", error: HELD, interrupted: "alarm" } },
    ]);
    expect(pipelines.git.discarded).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
  });

  it("ends a Script Stage's wait for a free run environment at once, with nothing run", async () => {
    const pipelines = await start();
    const taskId = randomUUID();
    pipelines.commands.waitsUntil = new Promise(() => undefined);
    pipelines.commands.observe = (call) => {
      if (call === "runCommand") void soundTheAlarm(pipelines, taskId);
    };

    await walkStages(pipelines, [tests, review], taskId);

    expect(await runsOf(pipelines, taskId)).toMatchObject([
      {
        stageKey: "tests",
        waitingSince: undefined,
        outcome: { status: "failed", error: HELD, interrupted: "alarm" },
      },
    ]);
    expect(pipelines.commands.ran).toEqual([]);
  });

  it("records an answer to a Task Waiting on you, but nothing walks until the Task resumes", async () => {
    const asked = anAskedDecision();
    const pipelines = await start([
      anAgentSession(A_WAITING_RESULT),
      anAgentSession(aDoneResult()),
    ]);
    asksOnce(pipelines, asked);
    const taskId = await walkStages(pipelines, [implement]);
    await soundTheAlarm(pipelines, taskId);

    await answerAsked(pipelines, taskId, asked, { kind: "option", option: 1 });

    expect(await statusesOf(pipelines, taskId)).toEqual([["implement", "needs-decision"]]);
    expect((await runsOf(pipelines, taskId))[0]?.decisions[0]?.answer).toBeDefined();
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");

    await resume(pipelines, taskId);

    expect(await statusesOf(pipelines, taskId)).toEqual([
      ["implement", "needs-decision"],
      ["implement", "done"],
    ]);
  });

  it("records a Gate action, but nothing walks until the Task resumes", async () => {
    const pipelines = await start([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, [gate, review]);
    await soundTheAlarm(pipelines, taskId);

    await pipelines.app.get(GateService, { strict: false }).continue(taskId);

    expect(await statusesOf(pipelines, taskId)).toEqual([["look", "done"]]);
    expect((await runsOf(pipelines, taskId))[0]?.gateAction).toEqual({ kind: "continue" });
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");

    await resume(pipelines, taskId);

    expect(await statusesOf(pipelines, taskId)).toEqual([
      ["look", "done"],
      ["review", "done"],
    ]);
  });
});

describe("What the all clear would resume", () => {
  it("is nothing yet while the held Stage's turn runs, then its session as the Stage would continue it in its Thread", async () => {
    const pipelines = await start([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    const resumes = pipelines.app.get(AlarmResumes, { strict: false });
    let whileStopping: unknown = "unread";
    whileTheFirstTurnRuns(pipelines, async () => {
      await soundTheAlarm(pipelines, taskId);
      whileStopping = await resumes.of(taskId);
    });
    await walkStages(pipelines, [implement, review], taskId);
    pipelines.stageThreads.ahead = {
      move: "resume",
      cacheWarm: true,
      contextTokens: 41_000,
      briefTokens: 3_000,
    };

    const planned = await resumes.of(taskId);

    const [held] = await runsOf(pipelines, taskId);
    expect(whileStopping).toBeUndefined();
    expect(pipelines.stageThreads.askedAhead).toEqual([
      expect.objectContaining({
        taskId,
        declared: undefined,
        previousThreadId: held?.threadId,
      }),
    ]);
    expect(planned).toEqual({
      kind: "continues-warm",
      stageName: "Implement",
      contextTokens: 41_000,
      briefTokens: 0,
      tokens: 4_100,
    });
  });

  it("re-caches a cold context, or starts fresh with a Brief, as the Context policy would", async () => {
    const pipelines = await start([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    whileTheFirstTurnRuns(pipelines, () => soundTheAlarm(pipelines, taskId));
    await walkStages(pipelines, [implement], taskId);
    const resumes = pipelines.app.get(AlarmResumes, { strict: false });

    pipelines.stageThreads.ahead = {
      move: "resume",
      cacheWarm: false,
      contextTokens: 12_000,
      briefTokens: 3_000,
    };
    const cold = await resumes.of(taskId);
    pipelines.stageThreads.ahead = {
      move: "fresh",
      cacheWarm: false,
      contextTokens: 48_000,
      briefTokens: 3_000,
    };
    const fresh = await resumes.of(taskId);

    expect(cold).toMatchObject({ kind: "re-caches", contextTokens: 12_000, tokens: 12_000 });
    expect(fresh).toMatchObject({ kind: "fresh", briefTokens: 3_000, tokens: 3_000 });
  });

  it("runs a Script Stage's script again, with no model call", async () => {
    const pipelines = await start();
    const taskId = randomUUID();
    pipelines.commands.runsUntilStopped = true;
    pipelines.commands.observe = (call) => {
      if (call === "runCommand") void soundTheAlarm(pipelines, taskId);
    };
    await walkStages(pipelines, [tests, review], taskId);

    const planned = await pipelines.app.get(AlarmResumes, { strict: false }).of(taskId);

    expect(planned).toEqual({
      kind: "script",
      stageName: "Tests",
      contextTokens: 0,
      briefTokens: 0,
      tokens: 0,
    });
    expect(pipelines.stageThreads.askedAhead).toEqual([]);
  });
});

describe("The Office starting with the fire alarm on", () => {
  it("holds a Task left In progress by a sounding it stopped during, its run held by the alarm, and walks nothing", async () => {
    const pipelines = await start();
    const threadId = randomUUID();
    const taskId = randomUUID();
    await pipelines.app.get(TaskStagesRepository, { strict: false }).save({
      taskId,
      pipelineId: "for-tests",
      stages: [implement],
      madeAt: new Date(),
      editedForTask: false,
      trace: undefined,
    });
    const { run } = startStageRun(
      {
        id: randomUUID(),
        taskId,
        stageKey: "implement",
        carriedFailure: undefined,
        sentBack: undefined,
      },
      0,
      new Date(),
    );
    const runs = pipelines.app.get(StageRunRepository, { strict: false });
    await runs.saveNew(run);
    await runs.saveThread(run.id, {
      threadId,
      session: "fresh",
      engineId: "claude-code",
      engineName: "Claude Code",
      model: "scripted",
    });
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts"]);
    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
    pipelines.tasks.fireAlarmOn = true;

    const interpreter = pipelines.app.get(StageInterpreter, { strict: false });
    await interpreter.onApplicationBootstrap();
    await interpreter.walked(taskId);

    expect(await runsOf(pipelines, taskId)).toMatchObject([
      { heldBy: "alarm", outcome: { interrupted: "alarm", cutShort: true } },
    ]);
    expect(pipelines.git.discarded).toEqual([]);
    expect(pipelines.engine.sessions).toEqual([]);
    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect(await pipelines.tasks.read(taskId)).toMatchObject({
      state: "paused",
      pausedByAlarm: true,
    });
  });
});
