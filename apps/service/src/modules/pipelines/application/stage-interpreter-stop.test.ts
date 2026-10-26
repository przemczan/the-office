import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { SessionScript } from "../../engine/index.js";
import { TaskPaused, TaskResumed, TaskStopped } from "../../work/index.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  answerLastDecision,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import type { Stage } from "../domain/stage.js";
import { PipelineCompleted, StopHeldAsPause } from "../domain/stage-run-events.js";
import { PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { StageInterpreter } from "./stage-interpreter.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

const implement = anAgentStage("implement", { name: "Implement" });
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};
const review = anAgentStage("review", { name: "Review & fix" });

/** A session whose first turn runs until The Office interrupts it. */
const interrupted: SessionScript = [
  { step: "start", brief: { id: "brief", text: "" } },
  {
    step: "event",
    event: { kind: "text", text: "Editing the dialog.", withinToolCall: undefined },
  },
  { step: "interrupt" },
  {
    step: "event",
    event: {
      kind: "turn-ended",
      outcome: "interrupted",
      consumedMessageIds: [],
      usage: { input: 5, output: 40, cacheRead: 0, cacheCreation: 0 },
      sessionCostUsd: 0.01,
      output: undefined,
      errors: [],
    },
  },
  { step: "end" },
];

const asking = anAgentSession({
  status: "needs_decision",
  summary: "Asked which page.",
  decision: {
    question: "Which page?",
    context: "Both list devices.",
    options: ["The device page", "The list"],
    recommendation: { option: 0, reason: "It has the room." },
  },
});

/** The user's Stop, as Work announces it once the Task is Paused. */
async function stop(taskId: string): Promise<void> {
  const { state } = await pipelines.tasks.read(taskId);
  pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskStopped(taskId, state as "in-progress"));
}

/** The user's Pause, as Work announces it once the Task is Paused. */
async function pause(taskId: string): Promise<void> {
  const { state } = await pipelines.tasks.read(taskId);
  pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskPaused(taskId, state as "in-progress"));
}

/** The user's Resume, as Work announces it, waiting for the walk it starts. */
async function resume(taskId: string): Promise<void> {
  pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
  await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);
}

/** Runs `action` once, as the first Stage's first turn runs. */
function whileTheFirstTurnRuns(taskId: string, action: (taskId: string) => Promise<void>): void {
  pipelines.stageThreads.whileTurnRuns = () => {
    pipelines.stageThreads.whileTurnRuns = undefined;
    void action(taskId);
  };
}

async function statusesOf(taskId: string): Promise<[string, string | undefined][]> {
  return (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
    stageKey,
    outcome?.status,
  ]);
}

describe("Stop", () => {
  it("interrupts the running turn now, discards the Stage's uncommitted edits and holds the Task", async () => {
    pipelines = await startPipelinesApplication([interrupted]);
    const taskId = randomUUID();
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts", "src/dialog.test.ts"]);
    whileTheFirstTurnRuns(taskId, stop);

    await walkStages(pipelines, [implement, review], taskId);

    const [run, ...more] = await runsOf(pipelines, taskId);
    const error =
      "Stopped by the user. The Office discarded the Stage's uncommitted edits to 2 files.";
    expect(run?.outcome).toEqual({ status: "failed", error, interrupted: "stop" });
    expect(run?.tokens.output).toBe(40);
    expect(run?.headCommit).toBe(PLANNED_COMMIT);
    expect(more).toEqual([]);
    expect(pipelines.stageThreads.interrupted).toEqual([run?.threadId]);
    // No correction is asked of an interrupted turn, and nothing is committed or asked.
    expect(pipelines.stageThreads.sent).toEqual([]);
    expect(pipelines.stageThreads.ended).toEqual([
      { threadId: run?.threadId, handoverNote: undefined, failure: error },
    ]);
    expect(pipelines.git.discarded).toEqual([
      { taskId, paths: ["src/dialog.ts", "src/dialog.test.ts"] },
    ]);
    expect(pipelines.git.commits).toEqual([]);
    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
  });

  it("starts no session when the Stage is stopped before its session begins", async () => {
    pipelines = await startPipelinesApplication([]);
    const taskId = randomUUID();
    pipelines.commands.observe = (call) => {
      if (call === "install") void stop(taskId);
    };

    await walkStages(pipelines, [implement], taskId);

    expect((await runsOf(pipelines, taskId)).map(({ outcome }) => outcome)).toEqual([
      {
        status: "failed",
        error: "Stopped by the user. The Stage had left no uncommitted edits.",
        interrupted: "stop",
      },
    ]);
    expect(pipelines.engine.sessions).toEqual([]);
    expect(pipelines.git.discarded).toEqual([{ taskId, paths: [] }]);
  });

  it("runs the stopped Stage again on Resume, in its Thread as the Context policy decides, told its edits are gone", async () => {
    pipelines = await startPipelinesApplication([
      interrupted,
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();
    whileTheFirstTurnRuns(taskId, stop);
    await walkStages(pipelines, [implement, review], taskId);
    const [stopped] = await runsOf(pipelines, taskId);

    await resume(taskId);

    const again = pipelines.stageThreads.requests[1];
    expect(again?.declared).toBeUndefined();
    expect(again?.previousThreadId).toBe(stopped?.threadId);
    expect(again?.carryMessagesSince).toEqual(stopped?.startedAt);
    expect(again?.work).toContain("## Stopped by the user\n\nThe user stopped this Stage");
    expect(await statusesOf(taskId)).toEqual([
      ["implement", "failed"],
      ["implement", "done"],
      ["review", "done"],
    ]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("done");
  });

  it("lets a Script Stage's command run to its end, holding the Task after it as Pause does, and says so", async () => {
    pipelines = await startPipelinesApplication([]);
    const taskId = randomUUID();
    pipelines.commands.observe = (call) => {
      if (call === "runCommand") void stop(taskId);
    };

    await walkStages(pipelines, [tests, anAgentStage("review")], taskId);

    expect(await statusesOf(taskId)).toEqual([["tests", "done"]]);
    expect(pipelines.git.discarded).toEqual([]);
    expect(pipelines.published.filter((event) => event instanceof StopHeldAsPause)).toEqual([
      expect.objectContaining({ taskId, stageKey: "tests" }),
    ]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
  });
});

describe("Pause", () => {
  it("holds the Stage once the Agent's turn ends, committing nothing, and Resume goes on with it through the Context policy", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts"]);
    whileTheFirstTurnRuns(taskId, pause);

    await walkStages(pipelines, [implement, review], taskId);

    const [paused, ...more] = await runsOf(pipelines, taskId);
    const error =
      "Paused by the user. The Stage's uncommitted edits stay in the worktree for it to go on with.";
    expect(paused?.outcome).toEqual({ status: "failed", error, interrupted: "pause" });
    expect(paused?.headCommit).toBe(PLANNED_COMMIT);
    expect(more).toEqual([]);
    expect(pipelines.stageThreads.interrupted).toEqual([]);
    expect(pipelines.stageThreads.sessionsEnded).toEqual([paused?.threadId]);
    expect(pipelines.git.commits).toEqual([]);
    expect(pipelines.git.discarded).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");

    await resume(taskId);

    const again = pipelines.stageThreads.requests[1];
    expect(again?.declared).toBeUndefined();
    expect(again?.previousThreadId).toBe(paused?.threadId);
    expect(again?.carryMessagesSince).toEqual(paused?.startedAt);
    expect(again?.work).toContain("## Paused by the user\n\nThe user paused this Stage");
    expect(await statusesOf(taskId)).toEqual([
      ["implement", "failed"],
      ["implement", "done"],
      ["review", "done"],
    ]);
    expect(pipelines.git.commits).toHaveLength(2);
    expect((await pipelines.tasks.read(taskId)).state).toBe("done");
  });

  it("stops the turn now when the user stops a Stage they paused", async () => {
    pipelines = await startPipelinesApplication([interrupted]);
    const taskId = randomUUID();
    whileTheFirstTurnRuns(taskId, async (id) => {
      await pause(id);
      await stop(id);
    });

    await walkStages(pipelines, [implement], taskId);

    const [run] = await runsOf(pipelines, taskId);
    expect(pipelines.stageThreads.interrupted).toEqual([run?.threadId]);
    expect(run?.outcome).toMatchObject({ interrupted: "stop" });
  });

  it("keeps a Task paused while Waiting on you paused once its Decision is answered, until Resume runs the Stage again", async () => {
    pipelines = await startPipelinesApplication([asking, anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, [implement]);
    await pause(taskId);

    await answerLastDecision(pipelines, taskId, { kind: "option", option: 1 });

    expect(await statusesOf(taskId)).toEqual([["implement", "needs-decision"]]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");

    await resume(taskId);

    expect(await statusesOf(taskId)).toEqual([
      ["implement", "needs-decision"],
      ["implement", "done"],
    ]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("done");
  });

  it("leaves a Task paused as its Pipeline completes Paused, completing it on Resume", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const { tasks } = pipelines;
    const changeState = tasks.changeState.bind(tasks);
    // The user pauses just as the walk, past the last Stage, moves the Task to Done.
    tasks.changeState = async (taskId, state) => {
      if (state === "done") {
        tasks.changeState = changeState;
        await pause(taskId);
      }
      return changeState(taskId, state);
    };

    const taskId = await walkStages(pipelines, [implement]);

    const completions = () =>
      pipelines.published.filter((event) => event instanceof PipelineCompleted);
    expect((await tasks.read(taskId)).state).toBe("paused");
    expect(completions()).toEqual([]);

    await resume(taskId);

    expect((await tasks.read(taskId)).state).toBe("done");
    expect(completions()).toHaveLength(1);
  });
});
