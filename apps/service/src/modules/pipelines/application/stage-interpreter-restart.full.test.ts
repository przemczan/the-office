import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskPaused, TaskResumed, TaskStopped } from "../../work/index.js";
import {
  AN_INTERRUPTED_SESSION,
  aDoneResult,
  anAgentSession,
  anAskedDecision,
  answerAsked,
  answerLastDecision,
  runsOf,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { interruptedOutcome } from "../domain/stage-interruption.js";
import { endStageRun } from "../domain/stage-run-changes.js";
import { PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";
import {
  implement,
  review,
  tests,
  RESTART_QUESTION,
  RESTARTED,
  open,
  start,
  close,
  startUp,
  aRunLeftRunning,
  outcomesOf,
} from "../stage-interpreter-restart.fixtures.js";

const CUT_SHORT_PAUSE = {
  status: "failed",
  error:
    "Paused by the user. The Office restarted during the Agent's last turn and cut it short: the Stage's uncommitted edits stay in the worktree, maybe half-done, for it to go on with.",
  interrupted: "pause",
  cutShort: true,
} as const;

const PAUSED_AND_CUT_SHORT =
  "## Paused by the user\n\nThe user paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.\n\nThe Office restarted during your last turn, which it cut short, so some of your edits may be half-done: check them before you go on.";

afterEach(async () => {
  await Promise.all([...open].map(close));
});

/** The user's Resume, as Work announces it, waiting for the walk it starts. */
async function resume(pipelines: PipelinesApplication, taskId: string): Promise<void> {
  pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
  await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);
}

describe("Shutting down during a Stage", () => {
  it("cuts the turn of a Stage the user paused short, but holds it paused with its edits, asking nothing", async () => {
    const before = await start([AN_INTERRUPTED_SESSION]);
    const taskId = randomUUID();
    before.git.uncommitted.set(taskId, ["src/dialog.ts"]);
    let closed: Promise<void> | undefined;
    before.stageThreads.whileTurnRuns = () => {
      before.stageThreads.whileTurnRuns = undefined;
      closed = (async () => {
        before.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
        await before.app.get(EventBus).publish(new TaskPaused(taskId, "in-progress"));
        await close(before);
      })();
    };

    await walkStages(before, [implement], taskId);
    await closed;
    expect(before.stageThreads.interrupted).toHaveLength(1);
    expect(before.git.discarded).toEqual([]);
    expect(before.git.commits).toEqual([]);

    const after = await start([anAgentSession(aDoneResult())]);
    await startUp(after, taskId, "paused");

    expect(await outcomesOf(after, taskId)).toEqual([CUT_SHORT_PAUSE]);
    expect(after.decisions.on(taskId)).toEqual([]);
    expect((await after.tasks.read(taskId)).state).toBe("paused");

    await resume(after, taskId);

    expect(after.stageThreads.requests[0]?.work).toContain(PAUSED_AND_CUT_SHORT);
    expect((await after.tasks.read(taskId)).state).toBe("done");
  });

  it("stops a Script Stage's command, which takes no Stop from the user, so the service doesn't wait for it", async () => {
    const before = await start();
    const taskId = randomUUID();
    before.commands.runsUntilStopped = true;
    let closed: Promise<void> | undefined;
    before.commands.observe = (call) => {
      if (call === "runCommand") closed = close(before);
    };

    await walkStages(before, [tests, review], taskId);
    await closed;

    const after = await start();
    const [run, ...more] = await runsOf(after, taskId);
    expect(run?.outcome).toEqual({ status: "failed", error: RESTARTED, interrupted: "restart" });
    expect(run?.commandRuns).toEqual([
      expect.objectContaining({ commandLine: "npm run test", outcome: "stopped" }),
    ]);
    expect(more).toEqual([]);
  });

  it("ends a Script Stage's wait for a free run environment at once as the service stops, with nothing run", async () => {
    const before = await start();
    const taskId = randomUUID();
    before.commands.waitsUntil = new Promise(() => undefined);
    let closed: Promise<void> | undefined;
    before.commands.observe = (call) => {
      if (call === "runCommand") closed = close(before);
    };

    await walkStages(before, [tests, review], taskId);
    await closed;

    expect(before.commands.ran).toEqual([]);
    const after = await start();
    const [run, ...more] = await runsOf(after, taskId);
    expect(run).toMatchObject({
      waitingSince: undefined,
      outcome: { status: "failed", interrupted: "restart" },
    });
    expect(more).toEqual([]);
  });
});

describe("Starting with a run left running", () => {
  it("keeps the Decision its Agent had opened: the walk waits on it, then runs the Stage again with its answer", async () => {
    const pipelines = await start([anAgentSession(aDoneResult()), anAgentSession(aDoneResult())]);
    const threadId = randomUUID();
    const taskId = await aRunLeftRunning(pipelines, [implement, review], threadId);
    const asked = anAskedDecision();
    pipelines.stageThreads.leftAsking.set(threadId, asked);

    await startUp(pipelines, taskId, "in-progress");

    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome).toMatchObject({ interrupted: "restart" });
    expect(run?.decisions).toEqual([
      expect.objectContaining({ id: asked.id, kind: "agent", question: asked.question }),
    ]);
    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("waiting-on-you");

    await answerAsked(pipelines, taskId, asked, { kind: "option", option: 0 });

    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect(pipelines.stageThreads.requests[0]?.work).toContain(
      "You asked the user: Which page?\n\nTheir answer: The device page",
    );
  });

  it("drops the Task when the user answers so at the third restart in a row", async () => {
    const pipelines = await start();
    const taskId = await aRunLeftRunning(pipelines, [implement], undefined, 2);
    await startUp(pipelines, taskId, "in-progress");
    expect(pipelines.decisions.on(taskId).map(({ draft }) => draft.question)).toEqual([
      RESTART_QUESTION,
    ]);

    await answerLastDecision(pipelines, taskId, { kind: "option", option: 1 });

    expect((await pipelines.tasks.read(taskId)).state).toBe("dropped");
    expect(await runsOf(pipelines, taskId)).toHaveLength(3);
    expect(pipelines.engine.sessions).toEqual([]);
  });

  it("holds the run of a Task the user paused as paused, its edits kept and its turn cut short, and Resume goes on with it", async () => {
    const pipelines = await start([anAgentSession(aDoneResult())]);
    const threadId = randomUUID();
    const taskId = await aRunLeftRunning(pipelines, [implement], threadId);
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts"]);

    await startUp(pipelines, taskId, "paused");

    const [held] = await runsOf(pipelines, taskId);
    expect(held?.outcome).toEqual(CUT_SHORT_PAUSE);
    expect(held?.headCommit).toBe(PLANNED_COMMIT);
    expect(pipelines.git.discarded).toEqual([]);
    expect(pipelines.stageThreads.endedLeftRunning).toEqual([
      { threadId, closing: { kind: "held", heldBy: "pause", text: CUT_SHORT_PAUSE.error } },
    ]);
    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");

    await resume(pipelines, taskId);

    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect(pipelines.stageThreads.requests[0]?.work).toContain(PAUSED_AND_CUT_SHORT);
    expect((await pipelines.tasks.read(taskId)).state).toBe("done");
  });

  it("honours the user's Stop recorded on a run a crash left running: its edits discarded, the Task Paused, nothing asked", async () => {
    const before = await start();
    const threadId = randomUUID();
    const taskId = await aRunLeftRunning(before, [implement], threadId);
    before.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
    await before.app.get(EventBus).publish(new TaskPaused(taskId, "in-progress"));
    await before.app.get(EventBus).publish(new TaskStopped(taskId, "paused"));
    expect((await runsOf(before, taskId))[0]?.heldBy).toBe("stop");
    await close(before);

    const after = await start([anAgentSession(aDoneResult())]);
    after.git.uncommitted.set(taskId, ["src/dialog.ts"]);
    await startUp(after, taskId, "paused");

    const error =
      "Stopped by the user. The Office discarded the Stage's uncommitted edits to 1 file.";
    expect(await outcomesOf(after, taskId)).toEqual([
      { status: "failed", error, interrupted: "stop" },
    ]);
    expect(after.git.discarded).toEqual([{ taskId, paths: ["src/dialog.ts"] }]);
    expect(after.stageThreads.endedLeftRunning).toEqual([
      { threadId, closing: { kind: "held", heldBy: "stop", text: error } },
    ]);
    expect(after.decisions.on(taskId)).toEqual([]);
    expect((await after.tasks.read(taskId)).state).toBe("paused");

    await resume(after, taskId);

    expect(after.decisions.on(taskId)).toEqual([]);
    expect(after.stageThreads.requests[0]?.work).toContain("## Stopped by the user");
    expect((await after.tasks.read(taskId)).state).toBe("done");
  });

  it("leaves a Stage the user paused before the shutdown as they held it", async () => {
    const pipelines = await start();
    const taskId = await aRunLeftRunning(pipelines, [implement]);
    const [running] = await runsOf(pipelines, taskId);
    if (!running) throw new Error("The run left running is missing.");
    const paused = endStageRun(running, interruptedOutcome("pause", []), new Date());
    await pipelines.app.get(StageRunRepository, { strict: false }).saveEnded(paused.run);

    await startUp(pipelines, taskId, "paused");

    expect(await outcomesOf(pipelines, taskId)).toEqual([paused.run.outcome]);
    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect(pipelines.git.discarded).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
  });
  it.each(["alarm", "usage-window"] as const)(
    "holds the run of a Task paused by the %s as it was, its edits kept, and starts nothing",
    async (pausedBy) => {
      const pipelines = await start();
      const taskId = await aRunLeftRunning(pipelines, [implement], randomUUID());
      pipelines.git.uncommitted.set(taskId, ["src/dialog.ts"]);
      pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests", pausedBy });
      const interpreter = pipelines.app.get(StageInterpreter, { strict: false });

      await interpreter.onApplicationBootstrap();
      await interpreter.walked(taskId);

      expect(await outcomesOf(pipelines, taskId)).toEqual([
        expect.objectContaining({ interrupted: pausedBy, cutShort: true }),
      ]);
      expect(pipelines.git.discarded).toEqual([]);
      expect(pipelines.decisions.on(taskId)).toEqual([]);
      expect(pipelines.engine.sessions).toEqual([]);
      expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
    },
  );
});
