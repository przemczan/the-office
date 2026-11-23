import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineSessions,
  FIRST_CLAUDE_CODE_ENGINE,
  type Engine,
  type EngineId,
  type EngineModel,
  type SessionScript,
} from "../../engine/index.js";
import { EngineSettingsForTests, EngineSettingsRepository } from "../../engine/index.fixtures.js";
import { TaskPaused, TaskResumed } from "../../work/index.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  aTurn,
  runsOf,
  startPipelinesApplicationOn,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import {
  A_REFUSED_SESSION,
  aRefusedTurn,
  implement,
  WINDOW_RESET,
} from "../agent-stage-runner.fixtures.js";
import { StageAwaitsStandInChoice, StageRunEngineSwitched } from "../domain/stage-run-events.js";
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { StandInChoices } from "./stand-in-choices.js";

const HOME: Engine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "home", name: "Home" };
const SPARE: Engine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "spare", name: "Spare" };
const ON_HOME: EngineModel = { engineId: HOME.id, model: "scripted" };
const CODEX: Engine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
  apiKey: null,
};
/** What a running Stage asks of its Stand-in Engine: one of its type, able to work an Agent Stage. */
const STAGE_ASKS = { sameEngineType: true, needs: ["officeTools", "outputSchema"] };

let pipelines: PipelinesApplication;

afterEach(async () => {
  vi.restoreAllMocks();
  await pipelines.app.close();
});

/**
 * Agent Stages' sessions replay `scripts` on the first Claude Code engine, with Home, Spare and
 * Codex listed beside it, Settings › Engines asking first above 100,000 tokens, its Stand-in
 * Engines `officeStandIns`; the cascade answers that list as the one applying for every Task.
 */
async function startOn(
  scripts: readonly SessionScript[],
  officeStandIns: readonly EngineId[] = [HOME.id, SPARE.id],
): Promise<void> {
  const settings = new EngineSettingsForTests({
    engines: [FIRST_CLAUDE_CODE_ENGINE, HOME, SPARE, CODEX],
    standInEngines: [...officeStandIns],
    askBeforeSwitchAbove: 100_000,
  });
  pipelines = await startPipelinesApplicationOn(
    {
      engineId: FIRST_CLAUDE_CODE_ENGINE.id,
      capabilities: {},
      overrides: [{ provide: EngineSettingsRepository, useValue: settings }],
    },
    scripts,
  );
  applyingStandIns({ from: "office", engineIds: officeStandIns });
}

/** The cascade answers `standIns` as the Stand-in Engine list that applies for every Task. */
function applyingStandIns(standIns: {
  readonly from: "office" | "project";
  readonly engineIds: readonly EngineId[];
}): void {
  const { officeDefault } = pipelines.cascade;
  if (officeDefault === null) throw new Error("The cascade lists no engine.");
  pipelines.cascade.officeDefault = {
    ...officeDefault,
    standIns: { from: standIns.from, engineIds: [...standIns.engineIds] },
  };
}

/**
 * As `startOn`, Engine answering `standIns` for the Stand-in Engine with room, in order, then none.
 */
async function start(
  scripts: readonly SessionScript[],
  standIns: readonly EngineId[],
): Promise<MockInstance<EngineSessions["standInFor"]>> {
  await startOn(scripts);
  const answers = [...standIns];
  return vi
    .spyOn(EngineSessions.prototype, "standInFor")
    .mockImplementation(async () => answers.shift() ?? null);
}

const SENT_AGAIN = { step: "send", message: { id: "again", text: "" }, priority: "later" } as const;

/** A session whose first turn is refused, then taken on the Stand-in Engine as `output`. */
function refusedThenDone(output: unknown = aDoneResult()): SessionScript {
  return [
    { step: "start", brief: { id: "brief", text: "" } },
    aRefusedTurn(),
    SENT_AGAIN,
    aTurn(output),
    { step: "end" },
  ];
}

async function resume(taskId: string): Promise<void> {
  pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
  await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);
}

const TO_HOME_WORDS =
  "Claude Code's 5-hour window was used up until 2026-11-13 14:00 UTC, so the Stage went on on Home.";

describe("AgentStageRunner, a turn refused for a used-up usage window with a Stand-in Engine (spec 5.4)", () => {
  it("goes on on the Stand-in Engine in the same run after a refused first turn, sent the work again", async () => {
    const standInFor = await start([refusedThenDone()], [HOME.id]);

    const taskId = await walkStages(pipelines, [implement]);

    const [run, ...more] = await runsOf(pipelines, taskId);
    expect(more).toEqual([]);
    expect(run?.outcome?.status).toBe("done");
    expect(run?.heldBy).toBeUndefined();
    expect(run).toMatchObject({
      engineId: HOME.id,
      engineName: "Home",
      standInFor: { engineId: "claude-code", engineName: "Claude Code", reason: TO_HOME_WORDS },
      engineSwitches: [
        {
          fromEngineId: "claude-code",
          fromEngineName: "Claude Code",
          toEngineId: HOME.id,
          toEngineName: "Home",
          windowWords: "5-hour window",
          resetsAt: WINDOW_RESET.toISOString(),
        },
      ],
    });
    expect(standInFor).toHaveBeenCalledWith("claude-code", {
      standIns: [HOME.id, SPARE.id],
      ...STAGE_ASKS,
    });
    expect(pipelines.stageThreads.switched).toEqual([
      {
        threadId: run?.threadId,
        standIn: ON_HOME,
        why: { window: "five-hour", resetsAt: WINDOW_RESET },
      },
    ]);
    const [again] = pipelines.stageThreads.sent;
    expect(again?.text).toContain("## Gone on on a Stand-in Engine");
    expect(again?.text).toContain("The message the engine refused was this Stage's work");
    expect(pipelines.tasks.standInsTakenOver).toEqual([
      {
        taskId,
        standIn: {
          engineId: "claude-code",
          engineName: "Claude Code",
          standInId: HOME.id,
          standInName: "Home",
          reason: TO_HOME_WORDS,
          short: "5-hour window used up",
        },
      },
    ]);
    // Running throughout: no hold, no pause.
    expect(pipelines.tasks.usageWindowPauses).toEqual([]);
    expect(pipelines.published.some((event) => event instanceof TaskPaused)).toBe(false);
    expect(pipelines.published.filter((event) => event instanceof StageRunEngineSwitched)).toEqual([
      expect.objectContaining({
        taskId,
        runId: run?.id,
        stageKey: "implement",
        fromEngineId: "claude-code",
        toEngineId: HOME.id,
      }),
    ]);
  });

  it("goes on on the Stand-in Engine after a refused correction, sent the correction again", async () => {
    await start(
      [
        [
          { step: "start", brief: { id: "brief", text: "" } },
          aTurn({ status: "done", summary: "Added the dialog." }),
          { step: "send", message: { id: "correction", text: "" }, priority: "later" },
          aRefusedTurn(),
          SENT_AGAIN,
          aTurn(aDoneResult()),
          { step: "end" },
        ],
      ],
      [HOME.id],
    );

    const taskId = await walkStages(pipelines, [implement]);

    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome?.status).toBe("done");
    expect(run?.engineSwitches).toHaveLength(1);
    expect(pipelines.stageThreads.switched).toHaveLength(1);
    const [correction, again] = pipelines.stageThreads.sent;
    expect(again?.text).toBe(correction?.text);
    expect(again?.text).toContain('status "done" requires "handoverNote".');
    expect(pipelines.tasks.standInsTakenOver).toHaveLength(1);
    expect(pipelines.tasks.usageWindowPauses).toEqual([]);
  });

  it("opens the run's next Stage on the Stand-in Engine", async () => {
    await start([refusedThenDone(), anAgentSession(aDoneResult())], [HOME.id]);
    pipelines.tasks.whenWentOnOnStandIn = (taskId, standIn) => {
      pipelines.records.put(taskId, aTaskRecord({ engineStandIns: [standIn] }));
    };

    const taskId = await walkStages(pipelines, [implement, anAgentStage("review")]);

    expect(pipelines.stageThreads.requests[1]?.engineStandIns).toMatchObject([
      { engineId: "claude-code", standInId: HOME.id, engineName: "Claude Code" },
    ]);
    const [, review] = await runsOf(pipelines, taskId);
    expect(review).toMatchObject({
      engineId: HOME.id,
      standInFor: { engineId: "claude-code" },
      engineSwitches: [],
      outcome: { status: "done" },
    });
  });

  it("tries the next Stand-in Engine when one refuses too, then pauses once none has room", async () => {
    const standInFor = await start(
      [
        [
          { step: "start", brief: { id: "brief", text: "" } },
          aRefusedTurn(),
          SENT_AGAIN,
          aRefusedTurn(),
          SENT_AGAIN,
          aRefusedTurn(),
          { step: "end" },
        ],
      ],
      [HOME.id, SPARE.id],
    );

    const taskId = await walkStages(pipelines, [implement]);

    expect(standInFor.mock.calls).toEqual([
      ["claude-code", { standIns: [HOME.id, SPARE.id], ...STAGE_ASKS }],
      [HOME.id, { standIns: [HOME.id, SPARE.id], ...STAGE_ASKS }],
      [SPARE.id, { standIns: [HOME.id, SPARE.id], ...STAGE_ASKS }],
    ]);
    const [held] = await runsOf(pipelines, taskId);
    expect(
      held?.engineSwitches.map(({ fromEngineId, toEngineId }) => [fromEngineId, toEngineId]),
    ).toEqual([
      ["claude-code", HOME.id],
      [HOME.id, SPARE.id],
    ]);
    expect(held).toMatchObject({
      engineId: SPARE.id,
      standInFor: { engineId: "claude-code" },
      heldBy: "usage-window",
      outcome: {
        interrupted: "usage-window",
        refused: { message: "work", engineName: "Spare" },
      },
    });
    // Each switch is for the cascade's engine, the one the Task's later Stages would run for.
    expect(pipelines.tasks.standInsTakenOver.map(({ standIn }) => standIn)).toMatchObject([
      { engineId: "claude-code", standInId: HOME.id },
      { engineId: "claude-code", standInId: SPARE.id },
    ]);
    expect(pipelines.tasks.usageWindowPauses).toMatchObject([
      { taskId, refusal: { engineId: SPARE.id, engineName: "Spare" } },
    ]);
  });

  it("pauses as before when no Stand-in Engine has room", async () => {
    await start([A_REFUSED_SESSION], []);

    const taskId = await walkStages(pipelines, [implement]);

    const [held] = await runsOf(pipelines, taskId);
    expect(held).toMatchObject({ heldBy: "usage-window", engineSwitches: [] });
    expect(held?.outcome).toMatchObject({ interrupted: "usage-window" });
    expect(held?.outcome).not.toHaveProperty("refused.standInChoice");
    expect(pipelines.stageThreads.switched).toEqual([]);
    expect(pipelines.tasks.usageWindowPauses).toHaveLength(1);
  });

  it("pauses, not fails, when the session can't be moved to the Stand-in Engine", async () => {
    await start([A_REFUSED_SESSION], [HOME.id]);
    pipelines.stageThreads.switchFails = new Error("The session couldn't be carried over.");

    const taskId = await walkStages(pipelines, [implement]);

    const [held] = await runsOf(pipelines, taskId);
    expect(held).toMatchObject({
      engineId: "claude-code",
      heldBy: "usage-window",
      engineSwitches: [],
      outcome: { status: "failed", interrupted: "usage-window", refused: { message: "work" } },
    });
    expect(pipelines.stageThreads.switched).toHaveLength(1);
    expect(pipelines.tasks.standInsTakenOver).toEqual([]);
    expect(pipelines.tasks.usageWindowPauses).toHaveLength(1);
  });

  it("leaves a run the user paused first held by them, moving nothing", async () => {
    const standInFor = await start([A_REFUSED_SESSION], [HOME.id]);
    const taskId = randomUUID();
    pipelines.stageThreads.whileTurnRuns = async () => {
      pipelines.stageThreads.whileTurnRuns = undefined;
      pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
      await pipelines.app.get(EventBus).publish(new TaskPaused(taskId, "in-progress"));
    };

    await walkStages(pipelines, [implement], taskId);

    const [held] = await runsOf(pipelines, taskId);
    expect(held?.outcome).toMatchObject({ interrupted: "pause", refused: { message: "work" } });
    expect(standInFor).not.toHaveBeenCalled();
    expect(pipelines.stageThreads.switched).toEqual([]);
    expect(pipelines.tasks.usageWindowPauses).toEqual([]);
  });

  it("holds a run the user paused while it switched on the Stand-in Engine, the refused message still to send", async () => {
    await start([A_REFUSED_SESSION], [HOME.id]);
    const taskId = randomUUID();
    pipelines.stageThreads.whileSwitching = async () => {
      pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
      await pipelines.app.get(EventBus).publish(new TaskPaused(taskId, "in-progress"));
    };

    await walkStages(pipelines, [implement], taskId);

    const [held] = await runsOf(pipelines, taskId);
    expect(held).toMatchObject({
      engineId: HOME.id,
      engineSwitches: [{ toEngineId: HOME.id }],
      outcome: {
        interrupted: "pause",
        refused: { message: "work", engineName: "Claude Code" },
      },
    });
    expect(pipelines.stageThreads.sent).toEqual([]);
    expect(pipelines.tasks.usageWindowPauses).toEqual([]);
  });
});

describe("AgentStageRunner, the Stand-in Engines a refused turn goes on on (spec 5.4.6)", () => {
  it("passes over a Stand-in Engine of another type, going on on the next of the session's type", async () => {
    await startOn([refusedThenDone()], [CODEX.id, HOME.id]);

    const taskId = await walkStages(pipelines, [implement]);

    const [run] = await runsOf(pipelines, taskId);
    expect(run).toMatchObject({ engineId: HOME.id, outcome: { status: "done" } });
    // The stand-in carries the session on its model.
    expect(pipelines.stageThreads.switched).toMatchObject([{ standIn: ON_HOME }]);
  });

  it("pauses until the reset when the only Stand-in Engine with room is of another type", async () => {
    await startOn([A_REFUSED_SESSION], [CODEX.id]);

    const taskId = await walkStages(pipelines, [implement]);

    const [held] = await runsOf(pipelines, taskId);
    expect(held).toMatchObject({ engineId: "claude-code", heldBy: "usage-window" });
    expect(held?.outcome).not.toHaveProperty("refused.standInChoice");
    expect(pipelines.stageThreads.switched).toEqual([]);
    expect(pipelines.tasks.usageWindowPauses).toHaveLength(1);
  });

  it("goes on on the Project's own list, not the Office's", async () => {
    await startOn([refusedThenDone()], [HOME.id]);
    applyingStandIns({ from: "project", engineIds: [SPARE.id] });

    const taskId = await walkStages(pipelines, [implement]);

    const [run] = await runsOf(pipelines, taskId);
    expect(run).toMatchObject({ engineId: SPARE.id, outcome: { status: "done" } });
    expect(pipelines.cascade.askedForEngine).toContainEqual({
      projectId: expect.any(String),
      taskId,
    });
  });
});

describe("AgentStageRunner, a refused turn whose context is over the size to ask first above", () => {
  it("pauses with the Stand-in Engine's choice and tells of it, which waits until the Task resumes", async () => {
    await start([A_REFUSED_SESSION, anAgentSession(aDoneResult())], [HOME.id]);
    pipelines.stageThreads.contextAfterTurn = { tokens: 182_000, window: 200_000 };

    const taskId = await walkStages(pipelines, [implement]);

    const [held] = await runsOf(pipelines, taskId);
    const standInChoice = {
      engineId: HOME.id,
      engineName: "Home",
      contextTokens: 182_000,
      askAbove: 100_000,
    };
    expect(held).toMatchObject({
      heldBy: "usage-window",
      engineSwitches: [],
      outcome: { interrupted: "usage-window", refused: { standInChoice } },
    });
    expect(pipelines.stageThreads.switched).toEqual([]);
    expect(pipelines.tasks.usageWindowPauses).toHaveLength(1);
    expect(
      pipelines.published.filter((event) => event instanceof StageAwaitsStandInChoice),
    ).toEqual([
      expect.objectContaining({
        taskId,
        runId: held?.id,
        stageKey: "implement",
        threadId: held?.threadId,
        fromEngineId: "claude-code",
        standInEngineId: HOME.id,
        contextTokens: 182_000,
        resetsAt: WINDOW_RESET,
      }),
    ]);
    const choices = pipelines.app.get(StandInChoices, { strict: false });
    expect(await choices.waiting()).toMatchObject([
      {
        taskId,
        runId: held?.id,
        stageKey: "implement",
        stageName: "Implement",
        threadId: held?.threadId,
        fromEngineId: "claude-code",
        fromEngineName: "Claude Code",
        asked: standInChoice,
        window: "five-hour",
        resetsAt: WINDOW_RESET.toISOString(),
      },
    ]);

    await resume(taskId);

    expect(await choices.waiting()).toEqual([]);
  });
});
