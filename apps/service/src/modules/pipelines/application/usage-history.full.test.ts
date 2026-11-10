import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import {
  EngineModule,
  ModelPrices,
  ScriptedEngine,
  ScriptedEngineModule,
  type EngineModel,
} from "../../engine/index.js";
import { aStageRun } from "../domain/stage-run.fixtures.js";
import type { StageRun, StageTokens } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { UsageHistoryModule } from "../usage-history.module.js";
import { UsageHistory } from "./usage-history.js";

/** Prices only Haiku on the Claude Code engines, a dollar per thousand input tokens. */
const modelPrices = {
  costOf: async ({ engineId, model }: EngineModel, tokens: StageTokens) =>
    engineId === "claude-code" && model === "claude-haiku-5-5" ? tokens.input / 1_000 : undefined,
};

function inputTokens(input: number): StageTokens {
  return { input, output: 0, cacheRead: 0, cacheCreation: 0 };
}

describe("UsageHistory", () => {
  let app: INestApplication;
  let history: UsageHistory;
  let runs: StageRunRepository;

  beforeAll(async () => {
    const engineModule = ScriptedEngineModule.register(new ScriptedEngine([]));
    ({ app } = await startTestApplication({
      database: true,
      imports: [EventsModule, TelemetryModule, engineModule, UsageHistoryModule],
      moduleOverrides: [{ module: EngineModule, useModule: engineModule }],
      overrides: [{ provide: ModelPrices, useValue: modelPrices }],
    }));
    history = app.get(UsageHistory);
    runs = app.get(StageRunRepository);
  });

  afterAll(async () => {
    await app.close();
  });

  async function aDoneTask(...taskRuns: readonly Partial<StageRun>[]): Promise<string> {
    const taskId = randomUUID();
    for (const [index, fields] of taskRuns.entries()) {
      await runs.saveNew(aStageRun({ id: randomUUID(), taskId, number: index + 1, ...fields }));
    }
    return taskId;
  }

  it("learns each Stage's tokens from the latest 20 of the done Tasks named", async () => {
    const oldest = await aDoneTask({ tokens: inputTokens(1_000_000), endedAt: new Date(0) });
    const latest = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        aDoneTask(
          { tokens: inputTokens(100), endedAt: new Date(1_000 + index) },
          { stageKey: "review", tokens: inputTokens(10), endedAt: new Date(2_000 + index) },
        ),
      ),
    );

    const usages = await history.of([oldest, ...latest]);

    expect(usages.get("implement")).toMatchObject({ tokens: inputTokens(100), samples: 20 });
    expect(usages.get("review")).toMatchObject({ tokens: inputTokens(10), samples: 20 });
  });

  it("knows nothing of no done Tasks", async () => {
    expect((await history.of([])).size).toBe(0);
  });

  it("prices each run by the engine id and model it ran on", async () => {
    const taskId = await aDoneTask(
      { engineId: "claude-code", model: "claude-haiku-5-5", tokens: inputTokens(1_000) },
      { engineId: "claude-code", model: "claude-haiku-5-5", tokens: inputTokens(3_000) },
      { engineId: "lab", model: "claude-haiku-5-5", tokens: inputTokens(5_000) },
      { tokens: inputTokens(7_000) },
    );

    expect(await history.dollarsPerToken([taskId])).toBe(4 / 4_000);
  });
});
