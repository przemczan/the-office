import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { TaskLocks } from "../../../platform/locks/task-locks.js";
import {
  EngineSessions,
  FIRST_CLAUDE_CODE_ENGINE,
  type Engine,
  type EngineModel,
  type SessionScript,
} from "../../engine/index.js";
import { EngineSettingsForTests, EngineSettingsRepository } from "../../engine/index.fixtures.js";
import {
  aDoneResult,
  anAgentSession,
  runsOf,
  startPipelinesApplicationOn,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { A_REFUSED_SESSION, implement, WINDOW_RESET } from "../agent-stage-runner.fixtures.js";
import { StandInChoicesChanged } from "../domain/stage-run-events.js";
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { StandInChoices } from "./stand-in-choices.js";
import { StandInSwitches } from "./stand-in-switches.js";

const HOME: Engine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "home", name: "Home" };
const SPARE: Engine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "spare", name: "Spare" };
const ON_HOME: EngineModel = { engineId: HOME.id, model: "scripted" };
const ON_SPARE: EngineModel = { engineId: SPARE.id, model: "scripted" };
const ANN_LEE = { userId: "ann", name: "Ann Lee" };

let pipelines: PipelinesApplication;
let standInFor: MockInstance<EngineSessions["standInFor"]>;

afterEach(async () => {
  vi.restoreAllMocks();
  await pipelines.app.close();
});

/**
 * Agent Stages' sessions replay `scripts` on the first Claude Code engine, with Home and Spare
 * listed beside it, Settings › Engines asking first above 100,000 tokens, and every turn's context
 * at 182,000 tokens, so a refused turn waits for the user's choice of Home. Each Task's record
 * names the Stand-in Engine its Stage went on on.
 */
async function start(scripts: readonly SessionScript[]): Promise<void> {
  const settings = new EngineSettingsForTests({
    engines: [FIRST_CLAUDE_CODE_ENGINE, HOME, SPARE],
    standInEngines: [HOME.id, SPARE.id],
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
  pipelines.stageThreads.contextAfterTurn = { tokens: 182_000, window: 200_000 };
  pipelines.tasks.whenWentOnOnStandIn = (taskId, standIn) => {
    pipelines.records.put(taskId, aTaskRecord({ engineStandIns: [standIn] }));
  };
  standInFor = vi.spyOn(EngineSessions.prototype, "standInFor").mockResolvedValue(ON_HOME);
}

/** A Task whose Implement Stage was held waiting for the user's choice; its held run's id. */
async function heldForChoice(): Promise<{ readonly taskId: string; readonly runId: string }> {
  const taskId = await walkStages(pipelines, [implement]);
  const [held] = await runsOf(pipelines, taskId);
  if (!held) throw new Error("No run was held.");
  return { taskId, runId: held.id };
}

function switches(): StandInSwitches {
  return pipelines.app.get(StandInSwitches, { strict: false });
}

function choices(): StandInChoices {
  return pipelines.app.get(StandInChoices, { strict: false });
}

function walked(taskId: string): Promise<void> {
  return pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);
}

describe("StandInSwitches, Switch now on a Stage waiting for a Stand-in Engine (spec 5.4)", () => {
  it("moves the session, records the stand-in and who chose it, and resumes the Task there", async () => {
    await start([A_REFUSED_SESSION, anAgentSession(aDoneResult())]);
    const { taskId, runId } = await heldForChoice();

    const results = await switches().switch([runId], ANN_LEE);
    await walked(taskId);

    expect(results).toEqual([{ runId, outcome: "switched", words: "It goes on on Home." }]);
    const [held, resumed] = await runsOf(pipelines, taskId);
    expect(pipelines.stageThreads.movedToStandIn).toEqual([
      {
        threadId: held?.threadId,
        standIn: ON_HOME,
        why: { from: "claude-code", window: "five-hour", resetsAt: WINDOW_RESET },
      },
    ]);
    expect(pipelines.tasks.standInsTakenOver).toMatchObject([
      { taskId, standIn: { engineId: "claude-code", standInId: HOME.id, standInName: "Home" } },
    ]);
    expect(held?.engineSwitches).toMatchObject([
      { fromEngineId: "claude-code", toEngineId: HOME.id, chosenBy: ANN_LEE },
    ]);
    expect(resumed).toMatchObject({ engineId: HOME.id, outcome: { status: "done" } });
    expect(pipelines.stageThreads.requests[1]?.work).toContain(
      "It goes on on Home, as the user Ann Lee chose",
    );
    expect(await choices().waiting()).toEqual([]);
  });

  it("switches to the Stand-in Engine with room at that moment", async () => {
    await start([A_REFUSED_SESSION, anAgentSession(aDoneResult())]);
    const { taskId, runId } = await heldForChoice();
    // Home ran out meanwhile, so Engine answers the next with room.
    standInFor.mockResolvedValue(ON_SPARE);

    const [result] = await switches().switch([runId], ANN_LEE);
    await walked(taskId);

    expect(result).toMatchObject({ outcome: "switched", words: "It goes on on Spare." });
    expect(pipelines.stageThreads.movedToStandIn).toMatchObject([{ standIn: ON_SPARE }]);
  });

  it("leaves the Stage paused, saying why, while no Stand-in Engine has room", async () => {
    await start([A_REFUSED_SESSION]);
    const { taskId, runId } = await heldForChoice();
    standInFor.mockResolvedValue(null);

    const [result] = await switches().switch([runId], ANN_LEE);

    expect(result).toEqual({
      runId,
      outcome: "no-room",
      words: "No Stand-in Engine has room now; it waits for the reset at 2026-11-13 14:00 UTC.",
    });
    expect(await pipelines.tasks.read(taskId)).toMatchObject({
      state: "paused",
      pausedBy: "usage-window",
    });
    expect(pipelines.stageThreads.movedToStandIn).toEqual([]);
    expect(await choices().waiting()).toMatchObject([{ runId, standInNow: null }]);
  });

  it("leaves the Stage paused on its own Engine when its session can't be moved", async () => {
    await start([A_REFUSED_SESSION]);
    const { taskId, runId } = await heldForChoice();
    pipelines.stageThreads.moveFails = new Error("The session couldn't be carried over");

    const [result] = await switches().switch([runId], ANN_LEE);

    expect(result).toEqual({
      runId,
      outcome: "failed",
      words:
        "Its session couldn't move to Home: The session couldn't be carried over. It stays on Claude Code, and it waits for the reset at 2026-11-13 14:00 UTC.",
    });
    expect(await pipelines.tasks.read(taskId)).toMatchObject({ state: "paused" });
    expect(pipelines.tasks.standInsTakenOver).toEqual([]);
    const [held] = await runsOf(pipelines, taskId);
    expect(held).toMatchObject({ engineId: "claude-code", engineSwitches: [] });
    expect(await choices().waiting()).toMatchObject([{ runId }]);
  });

  it("keeps the session on the stand-in when the Task can't resume, telling the user to Resume", async () => {
    await start([A_REFUSED_SESSION]);
    const { taskId, runId } = await heldForChoice();
    pipelines.tasks.resumeFails.set(taskId, new Error("The Task's Project is gone"));

    const [result] = await switches().switch([runId], ANN_LEE);

    expect(result).toEqual({
      runId,
      outcome: "moved-not-resumed",
      words:
        "Its session is on Home now, but it couldn't go on: The Task's Project is gone. Resume the Task to go on there.",
    });
    expect(pipelines.stageThreads.movedToStandIn).toHaveLength(1);
    expect(await pipelines.tasks.read(taskId)).toMatchObject({
      state: "paused",
      pausedBy: "usage-window",
    });
    const [held] = await runsOf(pipelines, taskId);
    expect(held?.engineSwitches).toMatchObject([{ toEngineId: HOME.id, chosenBy: ANN_LEE }]);
    expect(await choices().waiting()).toEqual([]);
  });

  it("switches each Task of Switch all on its own, one failing holding none of the others back", async () => {
    await start([A_REFUSED_SESSION, A_REFUSED_SESSION, anAgentSession(aDoneResult())]);
    const failing = await heldForChoice();
    const going = await heldForChoice();
    pipelines.tasks.resumeFails.set(failing.taskId, new Error("It can't resume"));

    const results = await switches().switch([failing.runId, going.runId], ANN_LEE);
    await walked(going.taskId);

    expect(results).toMatchObject([
      { runId: failing.runId, outcome: "moved-not-resumed" },
      { runId: going.runId, outcome: "switched" },
    ]);
    const [, resumed] = await runsOf(pipelines, going.taskId);
    expect(resumed).toMatchObject({ engineId: HOME.id, outcome: { status: "done" } });
  });

  it("answers an unforeseen failure as that Stage's own result, switching the others", async () => {
    await start([A_REFUSED_SESSION, A_REFUSED_SESSION, anAgentSession(aDoneResult())]);
    const failing = await heldForChoice();
    const going = await heldForChoice();
    standInFor.mockRejectedValueOnce(new Error("Settings › Engines couldn't be read"));

    const results = await switches().switch([failing.runId, going.runId], ANN_LEE);
    await walked(going.taskId);

    expect(results).toEqual([
      {
        runId: failing.runId,
        outcome: "failed",
        words: "It couldn't switch: Settings › Engines couldn't be read.",
      },
      { runId: going.runId, outcome: "switched", words: "It goes on on Home." },
    ]);
    expect(await choices().waiting()).toMatchObject([{ runId: failing.runId }]);
  });

  it("waits for the resume at the reset, then answers the Stage already went on", async () => {
    await start([A_REFUSED_SESSION, anAgentSession(aDoneResult())]);
    const { taskId, runId } = await heldForChoice();
    let reset!: () => void;
    const resetCame = new Promise<void>((resolve) => (reset = resolve));
    const resumingAtReset = pipelines.app
      .get(TaskLocks, { strict: false })
      .run(taskId, async () => {
        await resetCame;
        await pipelines.tasks.resume(taskId);
      });

    const clicked = switches().switch([runId], ANN_LEE);
    reset();
    await resumingAtReset;
    const [result] = await clicked;
    await walked(taskId);

    expect(result).toEqual({
      runId,
      outcome: "already-resumed",
      words: "It already went on on Claude Code, as its Task resumed.",
    });
    expect(pipelines.stageThreads.movedToStandIn).toEqual([]);
    const [, resumed] = await runsOf(pipelines, taskId);
    expect(resumed?.engineId).toBe("claude-code");
  });

  it("answers a Stage whose Task was stopped or dropped by hand no longer waits", async () => {
    await start([A_REFUSED_SESSION, A_REFUSED_SESSION]);
    const stopped = await heldForChoice();
    const dropped = await heldForChoice();
    pipelines.tasks.put(stopped.taskId, { state: "paused", pipelineId: "for-tests" });
    await pipelines.tasks.drop(dropped.taskId, { kind: "user", user: ANN_LEE });

    const results = await switches().switch([stopped.runId, dropped.runId], ANN_LEE);

    expect(results).toEqual([
      {
        runId: stopped.runId,
        outcome: "no-longer-waiting",
        words:
          "It no longer waits for this choice: its Task was resumed, paused or stopped by hand.",
      },
      {
        runId: dropped.runId,
        outcome: "no-longer-waiting",
        words: "It no longer waits for this choice: its Task was dropped.",
      },
    ]);
    expect(pipelines.stageThreads.movedToStandIn).toEqual([]);
  });

  it("switches a Stage clicked twice at once only once", async () => {
    await start([A_REFUSED_SESSION, anAgentSession(aDoneResult())]);
    const { taskId, runId } = await heldForChoice();

    const results = await Promise.all([
      switches().switch([runId], ANN_LEE),
      switches().switch([runId], ANN_LEE),
    ]);
    await walked(taskId);

    // Either click can take the Task's lock first; only one of them switches.
    const outcomes = results.map((result) => result[0]);
    expect(outcomes.map((result) => result?.outcome).toSorted()).toEqual([
      "no-longer-waiting",
      "switched",
    ]);
    expect(outcomes.find((result) => result?.outcome === "no-longer-waiting")?.words).toBe(
      "It was already switched to Home.",
    );
    expect(pipelines.stageThreads.movedToStandIn).toHaveLength(1);
    const [held] = await runsOf(pipelines, taskId);
    expect(held?.engineSwitches).toHaveLength(1);
  });

  it("tells the choices changed after each switch", async () => {
    await start([A_REFUSED_SESSION]);
    const { taskId, runId } = await heldForChoice();
    standInFor.mockResolvedValue(null);
    const before = pipelines.published.length;

    await switches().switch([runId], ANN_LEE);

    const told = pipelines.published
      .slice(before)
      .filter((event) => event instanceof StandInChoicesChanged);
    expect(told.map((event) => event.taskId)).toEqual([taskId]);
  });
});
