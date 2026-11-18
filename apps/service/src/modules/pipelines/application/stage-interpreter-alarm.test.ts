import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  AN_INTERRUPTED_SESSION,
  aDoneResult,
  anAgentSession,
  runsOf,
  walkStages,
} from "../pipelines-application.fixtures.js";
import { startStageRun } from "../domain/stage-run-changes.js";
import { PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";
import {
  implement,
  review,
  HELD,
  open,
  start,
  scheduleOf,
  soundTheAlarm,
  whileTheFirstTurnRuns,
  resume,
  statusesOf,
} from "../stage-interpreter-alarm.fixtures.js";

afterEach(async () => {
  await Promise.all(
    [...open].map((pipelines) => {
      open.delete(pipelines);
      return pipelines.app.close();
    }),
  );
});

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
      pausedBy: "alarm",
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
      standInFor: undefined,
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
      pausedBy: "alarm",
    });
  });
});
