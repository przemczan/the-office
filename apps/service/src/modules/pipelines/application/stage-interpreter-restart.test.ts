import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import {
  AN_INTERRUPTED_SESSION,
  aDoneResult,
  anAgentSession,
  answerLastDecision,
  runsOf,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { keepAnswers } from "../domain/stage-run-changes.js";
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

afterEach(async () => {
  await Promise.all([...open].map(close));
});

const BRIEF_AFTER_RESTART =
  "## The Office restarted\n\nThe Office restarted while this Stage ran, which cut your last turn short, and the Stage goes on now. The Stage's uncommitted edits are still in the worktree";

describe("Shutting down during a Stage", () => {
  it("ends the running session at once, keeping its edits, and at the next start goes on with the Stage by itself in its Thread, asking nothing", async () => {
    const before = await start([AN_INTERRUPTED_SESSION]);
    const taskId = randomUUID();
    before.git.uncommitted.set(taskId, ["src/dialog.ts"]);
    let closed: Promise<void> | undefined;
    before.stageThreads.whileTurnRuns = () => {
      before.stageThreads.whileTurnRuns = undefined;
      closed = close(before);
    };

    // Waiting for the turn to end would never return: only an interrupt ends it.
    await walkStages(before, [implement, review], taskId);
    await closed;
    expect(before.stageThreads.interrupted).toHaveLength(1);
    expect(before.git.discarded).toEqual([]);
    expect(before.git.commits).toEqual([]);

    const after = await start([anAgentSession(aDoneResult()), anAgentSession(aDoneResult())]);
    await startUp(after, taskId, "in-progress");

    const [restarted] = await runsOf(after, taskId);
    expect(restarted?.outcome).toEqual({
      status: "failed",
      error: RESTARTED,
      interrupted: "restart",
    });
    expect(after.decisions.on(taskId)).toEqual([]);
    const again = after.stageThreads.requests[0];
    expect(again?.declared).toBeUndefined();
    expect(again?.previousThreadId).toBe(restarted?.threadId);
    expect(again?.work).toContain(BRIEF_AFTER_RESTART);
    expect(again?.work).toContain("check `git status` and `git diff` first");
    expect(
      (await runsOf(after, taskId)).map(({ stageKey, outcome }) => [stageKey, outcome?.status]),
    ).toEqual([
      ["implement", "failed"],
      ["implement", "done"],
      ["review", "done"],
    ]);
    expect((await after.tasks.read(taskId)).state).toBe("done");
  });

  it("runs a Script Stage's commands again from the start at the next start", async () => {
    const before = await start();
    const taskId = randomUUID();
    before.commands.runsUntilStopped = true;
    let closed: Promise<void> | undefined;
    before.commands.observe = (call) => {
      if (call === "runCommand") closed = close(before);
    };
    await walkStages(before, [tests, review], taskId);
    await closed;

    const after = await start([anAgentSession(aDoneResult())]);
    await startUp(after, taskId, "in-progress");

    expect(
      (await runsOf(after, taskId)).map(({ stageKey, outcome }) => [stageKey, outcome?.status]),
    ).toEqual([
      ["tests", "failed"],
      ["tests", "done"],
      ["review", "done"],
    ]);
    expect(after.commands.ran).toEqual([expect.objectContaining({ taskId, key: "test" })]);
    expect(after.decisions.on(taskId)).toEqual([]);
    expect((await after.tasks.read(taskId)).state).toBe("done");
  });
});

describe("Starting with a run left running", () => {
  it("ends it as The Office restarted during it, keeping its edits, and runs the Stage again by itself", async () => {
    const pipelines = await start([anAgentSession(aDoneResult()), anAgentSession(aDoneResult())]);
    const threadId = randomUUID();
    const taskId = await aRunLeftRunning(pipelines, [implement, review], threadId);
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts", "src/dialog.test.ts"]);

    await startUp(pipelines, taskId, "in-progress");

    const [run, ...more] = await runsOf(pipelines, taskId);
    expect(run?.outcome).toEqual({ status: "failed", error: RESTARTED, interrupted: "restart" });
    expect(pipelines.git.discarded).toEqual([]);
    expect(pipelines.stageThreads.endedLeftRunning).toEqual([
      { threadId, closing: { kind: "failure", reason: RESTARTED } },
    ]);
    expect(run?.headCommit).toBe(PLANNED_COMMIT);
    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect(pipelines.stageThreads.requests[0]?.previousThreadId).toBe(threadId);
    expect(more.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["implement", "done"],
      ["review", "done"],
    ]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("done");
  });

  it("asks the user at the third restart in a row during the Stage, saying so, and runs it again with their words only once they answer", async () => {
    const pipelines = await start([anAgentSession(aDoneResult()), anAgentSession(aDoneResult())]);
    const threadId = randomUUID();
    const taskId = await aRunLeftRunning(pipelines, [implement, review], threadId, 2);

    await startUp(pipelines, taskId, "in-progress");

    expect(pipelines.decisions.on(taskId)).toEqual([
      expect.objectContaining({
        threadId,
        draft: expect.objectContaining({
          question: RESTART_QUESTION,
          options: ['Run "Implement" again', "Drop the Task"],
        }),
      }),
    ]);
    expect(pipelines.engine.sessions).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("waiting-on-you");

    await answerLastDecision(pipelines, taskId, {
      kind: "free-answer",
      text: "Skip the dialog's tests.",
    });

    const work = pipelines.stageThreads.requests[0]?.work;
    expect(work).toContain(BRIEF_AFTER_RESTART);
    expect(work).toContain("The user's words for it:\n\nSkip the dialog's tests.");
    expect((await pipelines.tasks.read(taskId)).state).toBe("done");
  });
});

describe("Shutting down between Stages", () => {
  it("starts the next Stage by itself at the next start", async () => {
    const before = await start();
    const taskId = randomUUID();
    let closed: Promise<void> | undefined;
    before.commands.observe = (call) => {
      if (call === "runCommand") closed = close(before);
    };
    await walkStages(before, [tests, review], taskId);
    await closed;

    const after = await start([anAgentSession(aDoneResult())]);
    await startUp(after, taskId, "in-progress");

    expect(await outcomesOf(after, taskId)).toEqual([
      expect.objectContaining({ status: "done" }),
      expect.objectContaining({ status: "done" }),
    ]);
    expect(after.decisions.on(taskId)).toEqual([]);
    expect(after.stageThreads.requests[0]?.declared).toBe("fresh");
    expect(after.stageThreads.requests[0]?.work).not.toContain("## The Office restarted");
    expect((await after.tasks.read(taskId)).state).toBe("done");
  });
});

/** A Task Waiting on you on the Decision asked at the third restart in a row, and its id. */
async function aTaskAsking(
  pipelines: PipelinesApplication,
): Promise<{ readonly taskId: string; readonly decisionId: string }> {
  const taskId = await aRunLeftRunning(pipelines, [implement, review], randomUUID(), 2);
  await startUp(pipelines, taskId, "in-progress");
  const decisionId = pipelines.decisions.on(taskId).at(-1)?.id;
  if (!decisionId) throw new Error("The walk asked nothing.");
  expect((await pipelines.tasks.read(taskId)).state).toBe("waiting-on-you");
  return { taskId, decisionId };
}

describe("Starting with a Task Waiting on you", () => {
  it("walks on from an answer its run kept as The Office stopped before the walk went on", async () => {
    const before = await start();
    const { taskId, decisionId } = await aTaskAsking(before);
    const [, , asking] = await runsOf(before, taskId);
    if (!asking) throw new Error("The run asking is missing.");
    await before.app
      .get(StageRunRepository, { strict: false })
      .update(asking.id, (run) => keepAnswers(run, new Map([[decisionId, RUN_AGAIN]])));
    await close(before);

    const after = await start([anAgentSession(aDoneResult()), anAgentSession(aDoneResult())]);
    await startUp(after, taskId, "waiting-on-you");

    expect(after.tasks.changes.map(({ state }) => state)).toEqual(["in-progress", "done"]);
    expect(after.decisions.on(taskId)).toEqual([]);
  });

  it("walks on from an answer given in Conversations that no run kept before The Office stopped", async () => {
    const before = await start();
    const { taskId, decisionId } = await aTaskAsking(before);
    await close(before);

    const after = await start([anAgentSession(aDoneResult()), anAgentSession(aDoneResult())]);
    after.decisions.answers.set(decisionId, RUN_AGAIN);
    await startUp(after, taskId, "waiting-on-you");

    expect((await after.tasks.read(taskId)).state).toBe("done");
    const decisions = (await runsOf(after, taskId)).flatMap((run) => run.decisions);
    expect(decisions).toEqual([
      expect.objectContaining({
        id: decisionId,
        answer: expect.objectContaining({ kind: "one-more-round" }),
      }),
    ]);
  });

  it("keeps waiting while nothing it waits on is answered", async () => {
    const before = await start();
    const { taskId } = await aTaskAsking(before);
    await close(before);

    const after = await start();
    await startUp(after, taskId, "waiting-on-you");

    expect(after.tasks.changes).toEqual([]);
    expect((await after.tasks.read(taskId)).state).toBe("waiting-on-you");
  });
});

describe("Taking an answer", () => {
  it("walks on a moment later when moving the Task on failed after the answer was kept", async () => {
    const pipelines = await start([anAgentSession(aDoneResult()), anAgentSession(aDoneResult())]);
    const taskId = await aRunLeftRunning(pipelines, [implement, review], randomUUID(), 2);
    await startUp(pipelines, taskId, "in-progress");
    failingOnceToGoOn(pipelines);

    await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

    expect((await pipelines.tasks.read(taskId)).state).toBe("waiting-on-you");
    const schedule = pipelines.app.get(Schedule, { strict: false });
    if (!(schedule instanceof ManualSchedule)) throw new Error("The schedule isn't the test's.");
    await schedule.advanceBy(60_000);
    await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);

    expect((await pipelines.tasks.read(taskId)).state).toBe("done");
  });

  it("opens the walk's Decision once when The Office stopped before its run kept it, and takes the answer given to it", async () => {
    const pipelines = await start([anAgentSession(aDoneResult()), anAgentSession(aDoneResult())]);
    const taskId = await aRunLeftRunning(pipelines, [implement, review], randomUUID(), 2);
    const openDecision = pipelines.decisions.open.bind(pipelines.decisions);
    pipelines.decisions.open = async (request) => {
      pipelines.decisions.open = openDecision;
      await openDecision(request);
      throw new Error("The Office stopped.");
    };

    await startUp(pipelines, taskId, "in-progress");
    const [first] = pipelines.decisions.on(taskId);
    if (!first) throw new Error("The walk asked nothing.");
    expect((await runsOf(pipelines, taskId)).flatMap((run) => run.decisions)).toEqual([]);
    pipelines.decisions.answers.set(first.id, RUN_AGAIN);
    const interpreter = pipelines.app.get(StageInterpreter, { strict: false });
    interpreter.walkInBackground(taskId);
    await interpreter.walked(taskId);

    expect(pipelines.decisions.on(taskId)).toEqual([first]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("done");
  });
});

const RUN_AGAIN = { kind: "option", option: 0 } as const;

/** The next move of a Task to In progress fails, as the database out of reach for a moment. */
function failingOnceToGoOn({ tasks }: PipelinesApplication): void {
  const changeState = tasks.changeState.bind(tasks);
  tasks.changeState = async (taskId, state, dropReason) => {
    if (state !== "in-progress") return changeState(taskId, state, dropReason);
    tasks.changeState = changeState;
    throw new Error("The database is out of reach.");
  };
}
