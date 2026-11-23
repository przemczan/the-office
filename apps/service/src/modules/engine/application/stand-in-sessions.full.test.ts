import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { setUp as setUpTelemetry } from "../../../platform/telemetry/telemetry.fixtures.js";
import { BusyWork } from "../../office-updates/index.js";
import { NoLanguageServers } from "../adapters/scripted/no-language-servers.js";
import { ScriptedEngine } from "../adapters/scripted/scripted-engine.js";
import {
  FIRST_CLAUDE_CODE_ENGINE,
  type ApiEngine,
  type ClaudeCodeEngine,
  type CodexEngine,
  type Engine,
} from "../domain/engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import { CapabilityMissing, EngineNotListed, SessionNotCarried } from "../ports/agent-engine.js";
import { DayUsageForTests } from "../ports/day-usage-repository.fixtures.js";
import { EngineSettingsForTests } from "../ports/engine-settings-repository.fixtures.js";
import { NO_TOKENS } from "../ports/session-events.js";
import { UsageWindowSamplesForTests } from "../ports/usage-window-sample-repository.fixtures.js";
import { AgentEngines } from "./agent-engines.js";
import { DayUsage } from "./day-usage.js";
import { EngineModels } from "./engine-models.js";
import { EngineSessions } from "./engine-sessions.js";
import { ModelPrices } from "./model-prices.js";
import { OfficeToolRegistry } from "./office-tool-registry.js";
import { RunningEngineSessions } from "./running-engine-sessions.js";
import { UsageWindowReadings } from "./usage-window-readings.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import { UsageWindowState } from "./usage-window-state.js";

const WORK = FIRST_CLAUDE_CODE_ENGINE;
const HOME: ClaudeCodeEngine = { ...WORK, id: "stand-in-home", name: "Home" };
const SPARE: ClaudeCodeEngine = { ...WORK, id: "stand-in-spare", name: "Spare", claudeCodeP: true };
const CODEX: CodexEngine = {
  id: "stand-in-codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
  apiKey: null,
};
const LAB: ApiEngine = {
  id: "stand-in-lab",
  name: "Lab",
  kind: "openai-compatible-api",
  defaultModel: "coder",
  defaultEffort: null,
  baseUrl: "http://localhost:11434/v1",
  key: "",
  models: [{ id: "coder", contextWindow: 32_000 }],
};

/**
 * Sessions over the scripted engines, the Agent SDK's and the fallback's carrying sessions, the
 * Codex and API engines' not, the API engine without Office tools, with the Office's Stand-in
 * Engines in `standIns`' order.
 */
function setUp(
  standIns: readonly string[],
  engines: readonly Engine[] = [WORK, HOME, SPARE, CODEX, LAB],
) {
  const settings = new EngineSettingsForTests({ engines, standInEngines: standIns });
  const events = new EventBus();
  const schedule = new ManualSchedule();
  const usageWindows = new UsageWindowState(events, schedule);
  const running = new RunningEngineSessions();
  const agentSdk = new ScriptedEngine([]);
  const claudeCodeP = new ScriptedEngine([]);
  const sessions = new EngineSessions(
    new AgentEngines({
      "agent-sdk": agentSdk,
      "claude-code-p": claudeCodeP,
      "openai-compatible-api": new ScriptedEngine([], { carrySession: false, officeTools: false }),
      codex: new ScriptedEngine([], { carrySession: false }),
      "copilot-cli": new ScriptedEngine([], { carrySession: false }),
      "gemini-cli": new ScriptedEngine([], { carrySession: false }),
    }),
    setUpTelemetry().telemetry,
    events,
    usageWindows,
    new OfficeToolRegistry(),
    new DayUsage(new DayUsageForTests(), schedule),
    new UsageWindowReadings(
      usageWindows,
      new UsageWindowSamples(new UsageWindowSamplesForTests()),
      schedule,
    ),
    new EngineModels(settings),
    running,
    new BusyWork(new EventBus()),
    new NoLanguageServers(),
    new ModelPrices(settings),
  );
  const read = (engine: Engine, fiveHour: number) =>
    usageWindows.update(engine, {
      ...windows(fiveHour),
      readAt: schedule.now(),
      officeTokensSoFar: NO_TOKENS,
    });
  const usedUp = (engine: Engine) =>
    usageWindows.refused(engine, {
      window: "five-hour",
      resetsAt: new Date(schedule.now().getTime() + 3_600_000),
      resetGiven: true,
    });
  return { sessions, agentSdk, claudeCodeP, running, read, usedUp };
}

/** Whether the sessions `ending` waits for have ended by the next turn of the event loop. */
function hasEnded(ending: Promise<void>): Promise<boolean> {
  const later = new Promise<boolean>((resolve) => {
    setImmediate(resolve, false);
  });
  return Promise.race([ending.then(() => true), later]);
}

function windows(fiveHour: number): UsageWindows {
  return {
    fiveHour: { percentUsed: fiveHour, resetsAt: undefined },
    sevenDay: { percentUsed: 10, resetsAt: undefined },
    source: "usage-endpoint",
  };
}

describe("EngineSessions.standInFor, the engine a refused session goes on on", () => {
  it("takes the first Stand-in Engine in order that has room", async () => {
    const { sessions } = setUp([]);

    await expect(sessions.standInFor(WORK.id, { standIns: [HOME.id, SPARE.id] })).resolves.toBe(
      HOME.id,
    );
  });

  it("weighs the list it is given, not the Office's", async () => {
    const { sessions } = setUp([HOME.id]);

    await expect(sessions.standInFor(WORK.id, { standIns: [SPARE.id] })).resolves.toBe(SPARE.id);
    await expect(sessions.standInFor(WORK.id, { standIns: [] })).resolves.toBeNull();
  });

  it("never gives the running engine, though it is listed as a Stand-in Engine and shows free", async () => {
    const { sessions, read } = setUp([]);
    await read(WORK, 10);

    await expect(sessions.standInFor(WORK.id, { standIns: [WORK.id] })).resolves.toBeNull();
  });

  it("skips an engine whose window is used up", async () => {
    const { sessions, usedUp } = setUp([]);
    await usedUp(HOME);

    await expect(sessions.standInFor(WORK.id, { standIns: [HOME.id, SPARE.id] })).resolves.toBe(
      SPARE.id,
    );
  });

  it("skips an engine whose latest reading isn't free, and takes one not read yet", async () => {
    const { sessions, read } = setUp([]);
    await read(HOME, 100);

    await expect(sessions.standInFor(WORK.id, { standIns: [HOME.id, SPARE.id] })).resolves.toBe(
      SPARE.id,
    );
  });

  it("takes a stand-in of another engine type unless sameEngineType is set", async () => {
    const { sessions } = setUp([]);
    const standIns = [CODEX.id, LAB.id, SPARE.id];

    await expect(sessions.standInFor(WORK.id, { standIns })).resolves.toBe(CODEX.id);
    await expect(sessions.standInFor(WORK.id, { standIns, sameEngineType: true })).resolves.toBe(
      SPARE.id,
    );
  });

  it("passes over a stand-in lacking a capability the session needs", async () => {
    const { sessions } = setUp([]);

    await expect(
      sessions.standInFor(WORK.id, { standIns: [LAB.id, CODEX.id], needs: ["officeTools"] }),
    ).resolves.toBe(CODEX.id);
  });

  it("gives none when no Stand-in Engine has room", async () => {
    const { sessions, read, usedUp } = setUp([]);
    await usedUp(HOME);
    await read(SPARE, 100);
    await usedUp(CODEX);

    await expect(
      sessions.standInFor(WORK.id, { standIns: [HOME.id, SPARE.id, CODEX.id] }),
    ).resolves.toBeNull();
  });

  it("gives a running Codex engine a stand-in that starts fresh, and none with sameEngineType", async () => {
    const { sessions } = setUp([]);

    await expect(sessions.standInFor(CODEX.id, { standIns: [HOME.id] })).resolves.toBe(HOME.id);
    await expect(
      sessions.standInFor(CODEX.id, { standIns: [HOME.id], sameEngineType: true }),
    ).resolves.toBeNull();
  });

  it("gives none for an engine no longer listed", async () => {
    const { sessions } = setUp([]);

    await expect(sessions.standInFor("gone", { standIns: [HOME.id] })).resolves.toBeNull();
  });
});

describe("EngineSessions.carrySession", () => {
  it("carries the session through the adapter of the engine it ran on", async () => {
    const { sessions, agentSdk, claudeCodeP } = setUp([]);

    await sessions.carrySession("session-1", WORK.id, SPARE.id);

    expect(agentSdk.carried).toEqual([{ sessionId: "session-1", from: WORK.id, to: SPARE.id }]);
    expect(claudeCodeP.carried).toEqual([]);
  });

  it("counts the session as running on the stand-in while it is copied", async () => {
    const { sessions, agentSdk, running } = setUp([]);
    let endedWhileCopying: boolean | undefined;
    agentSdk.carrySession = async () => {
      endedWhileCopying = await hasEnded(running.allEnded(HOME.id));
    };

    await sessions.carrySession("session-1", WORK.id, HOME.id);

    expect(endedWhileCopying).toBe(false);
    expect(await hasEnded(running.allEnded(HOME.id))).toBe(true);
  });

  it("refuses an engine not listed, and one whose sessions can't be carried", async () => {
    const { sessions, agentSdk } = setUp([]);

    await expect(sessions.carrySession("session-1", WORK.id, "gone")).rejects.toThrow(
      new EngineNotListed("gone"),
    );
    await expect(sessions.carrySession("session-1", WORK.id, CODEX.id)).rejects.toThrow(
      new CapabilityMissing("carrySession"),
    );
    expect(agentSdk.carried).toEqual([]);
  });

  it("passes on the adapter's refusal of a session it holds no transcript of", async () => {
    const { sessions, agentSdk } = setUp([]);
    agentSdk.failSessionCarries(new SessionNotCarried("session-1", WORK.id));

    await expect(sessions.carrySession("session-1", WORK.id, HOME.id)).rejects.toThrow(
      SessionNotCarried,
    );
  });
});
