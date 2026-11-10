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

describe("Shutting down during a Stage", () => {
  it("ends the running session at once, and at the next start asks whether to run the Stage again, which the user's words go with", async () => {
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
    expect(before.git.discarded).toEqual([{ taskId, paths: ["src/dialog.ts"] }]);
    expect(before.git.commits).toEqual([]);

    const after = await start([anAgentSession(aDoneResult()), anAgentSession(aDoneResult())]);
    await startUp(after, taskId, "in-progress");

    const [restarted] = await runsOf(after, taskId);
    expect(restarted?.outcome).toEqual({
      status: "failed",
      error:
        "The Office restarted during this Stage. The Office discarded the Stage's uncommitted edits to 1 file.",
      interrupted: "restart",
    });
    expect(after.decisions.on(taskId)).toEqual([
      expect.objectContaining({
        threadId: restarted?.threadId,
        draft: expect.objectContaining({
          question: RESTART_QUESTION,
          options: ['Run "Implement" again', "Drop the Task"],
        }),
      }),
    ]);
    expect(after.engine.sessions).toEqual([]);
    expect((await after.tasks.read(taskId)).state).toBe("waiting-on-you");

    await answerLastDecision(after, taskId, {
      kind: "free-answer",
      text: "Skip the dialog's tests.",
    });

    const again = after.stageThreads.requests[0];
    expect(again?.declared).toBeUndefined();
    expect(again?.previousThreadId).toBe(restarted?.threadId);
    expect(again?.work).toContain("## The Office restarted\n\nThe Office restarted while");
    expect(again?.work).toContain("The user's words for it:\n\nSkip the dialog's tests.");
    expect(
      (await runsOf(after, taskId)).map(({ stageKey, outcome }) => [stageKey, outcome?.status]),
    ).toEqual([
      ["implement", "failed"],
      ["implement", "done"],
      ["review", "done"],
    ]);
  });
});

describe("Starting with a run left running", () => {
  it("ends it as The Office restarted during it, discarding its edits, and asks the user rather than running it again", async () => {
    const pipelines = await start();
    const threadId = randomUUID();
    const taskId = await aRunLeftRunning(pipelines, [implement, review], threadId);
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts", "src/dialog.test.ts"]);

    await startUp(pipelines, taskId, "in-progress");

    const [run, ...more] = await runsOf(pipelines, taskId);
    const error =
      "The Office restarted during this Stage. The Office discarded the Stage's uncommitted edits to 2 files.";
    expect(run?.outcome).toEqual({ status: "failed", error, interrupted: "restart" });
    expect(more).toEqual([]);
    expect(pipelines.stageThreads.endedLeftRunning).toEqual([
      { threadId, closing: { kind: "failure", reason: error } },
    ]);
    expect(run?.headCommit).toBe(PLANNED_COMMIT);
    expect(pipelines.decisions.on(taskId).map(({ draft }) => draft.question)).toEqual([
      RESTART_QUESTION,
    ]);
    expect(pipelines.engine.sessions).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("waiting-on-you");
  });
});

describe("Shutting down between Stages", () => {
  it("asks at the next start whether to start the next Stage, which starts with the user's words only once they answer", async () => {
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
      {
        status: "failed",
        error: "The Office restarted before this Stage started.",
        interrupted: "restart",
        notStarted: true,
      },
    ]);
    expect(after.decisions.on(taskId)).toEqual([
      expect.objectContaining({
        draft: expect.objectContaining({
          question: 'The Office restarted before "Review & fix". Start it?',
          options: ['Start "Review & fix"', "Drop the Task"],
        }),
      }),
    ]);
    expect(after.engine.sessions).toEqual([]);
    expect((await after.tasks.read(taskId)).state).toBe("waiting-on-you");

    await answerLastDecision(after, taskId, { kind: "free-answer", text: "Look at the dialog." });

    const work = after.stageThreads.requests[0]?.work;
    expect(work).toContain("## The user's words for this Stage\n\nLook at the dialog.");
    expect(work).not.toContain("## The Office restarted");
    expect(after.stageThreads.requests[0]?.declared).toBe("fresh");
    expect((await after.tasks.read(taskId)).state).toBe("done");
  });
});
