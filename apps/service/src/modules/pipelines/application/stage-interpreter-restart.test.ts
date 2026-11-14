import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  AN_INTERRUPTED_SESSION,
  aDoneResult,
  anAgentSession,
  answerLastDecision,
  runsOf,
  walkStages,
} from "../pipelines-application.fixtures.js";
import { PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
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
