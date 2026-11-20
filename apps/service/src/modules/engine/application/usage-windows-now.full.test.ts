import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { codex, strata } from "../domain/engine-settings.fixtures.js";
import { DEFAULT_ENGINE_SETTINGS } from "../domain/engine-settings.js";
import { FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../domain/engines.js";
import type { EngineSettingsRepository } from "../ports/engine-settings-repository.js";
import { NO_TOKENS } from "../ports/session-events.js";
import { EngineModels } from "./engine-models.js";
import { UsageWindowState } from "./usage-window-state.js";
import { UsageWindowsNow } from "./usage-windows-now.js";

const WORK_ACCOUNT: Engine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "work-account", name: "Work" };
const CODEX_ON_CHATGPT: Engine = { ...codex, id: "codex-plan", name: "Codex plan", apiKey: null };

function windowsNowOf(engines: readonly Engine[]) {
  const settings = {
    read: async () => ({ ...DEFAULT_ENGINE_SETTINGS, engines }),
  } as unknown as EngineSettingsRepository;
  const state = new UsageWindowState(new EventBus(), new ManualSchedule());
  return { state, windowsNow: new UsageWindowsNow(new EngineModels(settings), state) };
}

describe("UsageWindowsNow", () => {
  it("lists every engine in Settings › Engines' order: none, not read yet, or as last read", async () => {
    const { state, windowsNow } = windowsNowOf([
      WORK_ACCOUNT,
      strata,
      FIRST_CLAUDE_CODE_ENGINE,
      codex,
      CODEX_ON_CHATGPT,
    ]);
    const readAt = new Date("2026-11-17T09:00:00.000Z");
    const fiveHour = { percentUsed: 41, resetsAt: new Date("2026-11-17T14:00:00.000Z") };
    const sevenDay = { percentUsed: 12, resetsAt: undefined };
    await state.update(FIRST_CLAUDE_CODE_ENGINE, {
      fiveHour,
      sevenDay,
      source: "usage-endpoint",
      readAt,
      officeTokensSoFar: NO_TOKENS,
    });

    await expect(windowsNow.list()).resolves.toEqual([
      { engineId: "work-account", name: "Work", windows: { state: "not-read" } },
      { engineId: "strata", name: "Strata", windows: { state: "none" } },
      {
        engineId: "claude-code",
        name: "Claude Code",
        windows: { state: "read", fiveHour, sevenDay, readAt },
      },
      { engineId: "codex", name: "Codex", windows: { state: "none" } },
      { engineId: "codex-plan", name: "Codex plan", windows: { state: "not-read" } },
    ]);
  });
});
