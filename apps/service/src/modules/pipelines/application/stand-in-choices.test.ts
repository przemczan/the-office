import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineSessions,
  FIRST_CLAUDE_CODE_ENGINE,
  type Engine,
  type SessionScript,
} from "../../engine/index.js";
import { EngineSettingsForTests, EngineSettingsRepository } from "../../engine/index.fixtures.js";
import { TaskResumed, TaskStopped } from "../../work/index.js";
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
const CODEX: Engine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
  apiKey: null,
};

let pipelines: PipelinesApplication;

afterEach(async () => {
  vi.restoreAllMocks();
  await pipelines.app.close();
});

/**
 * Agent Stages' sessions replay `scripts`, each turn's context over the 100,000 tokens Settings ›
 * Engines asks first above, Home the Stand-in Engine with room; `{ engines: "as listed" }` leaves
 * Engine to answer it from the list the cascade applies, Codex listed beside Home.
 */
async function start(
  scripts: readonly SessionScript[],
  { engines }: { readonly engines?: "as listed" } = {},
): Promise<void> {
  const settings = new EngineSettingsForTests({
    engines: [FIRST_CLAUDE_CODE_ENGINE, HOME, CODEX],
    standInEngines: [HOME.id],
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
  if (engines === "as listed") return;
  vi.spyOn(EngineSessions.prototype, "standInFor").mockResolvedValue(HOME.id);
}

/** The cascade answers `engineIds` as the Project's own Stand-in Engine list for every Task. */
function projectStandIns(engineIds: readonly string[]): void {
  const { officeDefault } = pipelines.cascade;
  if (officeDefault === null) throw new Error("The cascade lists no engine.");
  pipelines.cascade.officeDefault = {
    ...officeDefault,
    standIns: { from: "project", engineIds: [...engineIds] },
  };
}

function choices(): StandInChoices {
  return pipelines.app.get(StandInChoices, { strict: false });
}

function told(): number {
  return pipelines.published.filter((event) => event instanceof StandInChoicesChanged).length;
}

describe("StandInChoices, the Stages waiting for the user's choice of a Stand-in Engine (spec 5.4)", () => {
  it("lists each Stage held so, the one that pauses later joining, and tells of each", async () => {
    await start([A_REFUSED_SESSION, A_REFUSED_SESSION]);
    const first = await walkStages(pipelines, [implement]);
    pipelines.records.put(first, aTaskRecord({ title: "Fix the login" }));
    expect(told()).toBe(1);

    const second = await walkStages(pipelines, [implement]);

    expect(told()).toBe(2);
    expect(await choices().waiting()).toMatchObject([
      {
        taskId: first,
        taskTitle: "Fix the login",
        projectId: "test-project",
        stageName: "Implement",
        fromEngineName: "Claude Code",
        asked: { contextTokens: 182_000, askAbove: 100_000 },
        resetsAt: WINDOW_RESET.toISOString(),
        standInNow: { engineId: HOME.id, engineName: "Home" },
      },
      { taskId: second },
    ]);
  });

  it("drops a Stage whose Task the user resumed or stopped by hand", async () => {
    await start([A_REFUSED_SESSION, A_REFUSED_SESSION, anAgentSession(aDoneResult())]);
    const resumed = await walkStages(pipelines, [implement]);
    const stopped = await walkStages(pipelines, [implement]);
    const before = told();

    await pipelines.tasks.resume(resumed);
    await pipelines.app.get(StageInterpreter, { strict: false }).walked(resumed);
    pipelines.tasks.put(stopped, { state: "paused", pipelineId: "for-tests" });
    await pipelines.app.get(EventBus).publish(new TaskStopped(stopped, "paused"));

    expect(await choices().waiting()).toEqual([]);
    expect(told()).toBe(before + 2);
  });

  it("is empty once the reset resumed the Stage, or the user switched it", async () => {
    await start([A_REFUSED_SESSION, A_REFUSED_SESSION, anAgentSession(aDoneResult())]);
    const atReset = await walkStages(pipelines, [implement]);
    const switched = await walkStages(pipelines, [implement]);
    pipelines.tasks.put(atReset, { state: "in-progress", pipelineId: "for-tests" });
    pipelines.tasks.put(switched, { state: "paused", pausedBy: "usage-window", pipelineId: "p" });
    await pipelines.app.get(EventBus).publish(new TaskResumed(atReset));
    await pipelines.app.get(StageInterpreter, { strict: false }).walked(atReset);
    pipelines.tasks.resumeFails.set(switched, new Error("Not now"));
    const [held] = await runsOf(pipelines, switched);

    await pipelines.app
      .get(StandInSwitches, { strict: false })
      .switch([held?.id ?? ""], { userId: "ann", name: "Ann Lee" });

    expect(await choices().waiting()).toEqual([]);
  });
});

describe("StandInChoices, the Stand-in Engine a held Stage would move to now (spec 5.4.6)", () => {
  it("offers only a Stand-in Engine of the session's type from the Project's own list", async () => {
    await start([A_REFUSED_SESSION], { engines: "as listed" });
    projectStandIns([CODEX.id, HOME.id]);
    const taskId = await walkStages(pipelines, [implement]);

    expect(await choices().waiting()).toMatchObject([
      {
        taskId,
        asked: { engineId: HOME.id },
        standInNow: { engineId: HOME.id, engineName: "Home" },
      },
    ]);

    projectStandIns([CODEX.id]);

    expect(await choices().waiting()).toMatchObject([{ taskId, standInNow: null }]);
  });
});
