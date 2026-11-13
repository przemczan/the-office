import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskPaused, TaskResumed } from "../../work/index.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import {
  A_REFUSED_SESSION,
  implement,
  refusedCorrection,
  WINDOW_RESET,
} from "../agent-stage-runner.fixtures.js";
import { StageInterpreter } from "./stage-interpreter.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  vi.restoreAllMocks();
  await pipelines.app.close();
});

/** Work's resume of the Task, at the window's reset or by the user, waiting for the walk it starts. */
async function resume(taskId: string): Promise<void> {
  pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
  await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);
}

async function statusesOf(taskId: string): Promise<[string, string | undefined][]> {
  return (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
    stageKey,
    outcome?.status,
  ]);
}

const REFUSED_WORDS =
  "Paused: Claude Code's 5-hour window is used up until 2026-11-13 14:00 UTC. The engine refused the Agent's turn, which is no failure";

describe("AgentStageRunner, a turn refused for a used-up usage window (spec 2.3)", () => {
  it("holds the run on a refused first turn, pauses the Task until the reset, and spends no correction, retry or Decision", async () => {
    pipelines = await startPipelinesApplication([A_REFUSED_SESSION]);
    const interrupt = vi.spyOn(StageInterpreter.prototype, "interrupt");
    const taskId = randomUUID();
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts"]);

    await walkStages(
      pipelines,
      [
        anAgentStage("implement", {
          name: "Implement",
          onFailure: { goBackTo: "implement", rounds: 2 },
        }),
      ],
      taskId,
    );

    const [held, ...more] = await runsOf(pipelines, taskId);
    expect(held?.outcome).toEqual({
      status: "failed",
      error: expect.stringContaining(REFUSED_WORDS) as string,
      interrupted: "usage-window",
      refused: {
        message: "work",
        sessionLeft: false,
        engineName: "Claude Code",
        windowWords: "5-hour window",
        resetsAt: WINDOW_RESET.toISOString(),
      },
    });
    expect(held?.heldBy).toBe("usage-window");
    expect(more).toEqual([]);
    expect(pipelines.tasks.usageWindowPauses).toEqual([
      {
        taskId,
        refusal: {
          engineId: "claude-code",
          engineName: "Claude Code",
          window: "five-hour",
          resetsAt: WINDOW_RESET,
        },
      },
    ]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
    // No correction, no interrupt, no Decision; the edits stay, uncommitted.
    expect(pipelines.stageThreads.sent).toEqual([]);
    expect(pipelines.stageThreads.interrupted).toEqual([]);
    expect(pipelines.decisions.opened.size).toBe(0);
    expect(pipelines.git.commits).toEqual([]);
    expect(pipelines.git.discarded).toEqual([]);
    expect(pipelines.stageThreads.ended[0]?.closing).toMatchObject({
      kind: "held",
      heldBy: "usage-window",
    });
    // Ended held once, by the runner: Work's TaskPaused asks the walk nothing.
    expect(pipelines.published.some((event) => event instanceof TaskPaused)).toBe(true);
    expect(interrupt).not.toHaveBeenCalled();
  });

  it("begins anew with the full Brief after a refused first turn that left no session, sent the Stage's work again", async () => {
    pipelines = await startPipelinesApplication([A_REFUSED_SESSION, anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, [implement]);

    await resume(taskId);

    const again = pipelines.stageThreads.requests[1];
    // The Stage's own declared session, as when it first began.
    expect(again?.declared).toBe("fresh");
    expect(again?.previousThreadId).toBeUndefined();
    expect(again?.work).toContain("## Paused for the usage window");
    expect(again?.work).toContain("## The Stage: Implement");
    expect(again?.work).toContain("The message the engine refused was this Stage's work");
    expect(again?.work).toContain("some of your edits may be half-done");
    expect(await statusesOf(taskId)).toEqual([
      ["implement", "failed"],
      ["implement", "done"],
    ]);
  });

  it("goes on in its own Thread after a refused first turn of a session it continued", async () => {
    pipelines = await startPipelinesApplication([A_REFUSED_SESSION, anAgentSession(aDoneResult())]);
    pipelines.stageThreads.move = "resume";
    const taskId = await walkStages(pipelines, [implement]);
    const [held] = await runsOf(pipelines, taskId);

    await resume(taskId);

    expect(held?.outcome).toMatchObject({ refused: { message: "work", sessionLeft: true } });
    const again = pipelines.stageThreads.requests[1];
    expect(again?.declared).toBeUndefined();
    expect(again?.previousThreadId).toBe(held?.threadId);
  });

  it("holds the run on a refused correction, and the resumed Stage is sent the correction again in its Thread", async () => {
    pipelines = await startPipelinesApplication([
      refusedCorrection({ status: "done", summary: "Added the dialog." }),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = await walkStages(pipelines, [implement]);
    const [held] = await runsOf(pipelines, taskId);

    expect(held?.outcome).toMatchObject({
      interrupted: "usage-window",
      refused: { message: "correction", sessionLeft: true },
    });
    expect(pipelines.stageThreads.sent).toHaveLength(1);
    expect(pipelines.tasks.usageWindowPauses).toHaveLength(1);

    await resume(taskId);

    const again = pipelines.stageThreads.requests[1];
    expect(again?.declared).toBeUndefined();
    expect(again?.previousThreadId).toBe(held?.threadId);
    expect(again?.work).toContain(
      "The message the engine refused was The Office's request to correct your result",
    );
    expect(again?.work).toContain('status "done" requires "handoverNote".');
    expect(again?.work).toContain("Don't redo the work");
    expect(again?.work).toContain("some of your edits may be half-done");
    expect(await statusesOf(taskId)).toEqual([
      ["implement", "failed"],
      ["implement", "done"],
    ]);
  });

  it("leaves a run the user paused meanwhile paused by the user, keeping the refused message to send again", async () => {
    pipelines = await startPipelinesApplication([A_REFUSED_SESSION]);
    const taskId = randomUUID();
    pipelines.stageThreads.whileTurnRuns = async () => {
      pipelines.stageThreads.whileTurnRuns = undefined;
      pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
      await pipelines.app.get(EventBus).publish(new TaskPaused(taskId, "in-progress"));
    };

    await walkStages(pipelines, [implement], taskId);

    const [held] = await runsOf(pipelines, taskId);
    expect(held?.outcome).toMatchObject({ interrupted: "pause", refused: { message: "work" } });
    expect(pipelines.tasks.usageWindowPauses).toEqual([]);
  });
});
