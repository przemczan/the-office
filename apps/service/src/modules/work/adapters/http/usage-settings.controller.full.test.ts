import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  taskUsageEstimateListSchema,
  usageSettingsSchema,
  type UsageSettings,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineModels, FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../../../engine/index.js";
import { EngineSettingsForTests } from "../../../engine/index.fixtures.js";
import { WorkSettingsForTests } from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "usage-settings-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

/** A second Claude Code account, which has windows of its own. */
const WORK_ACCOUNT: Engine = {
  ...FIRST_CLAUDE_CODE_ENGINE,
  id: "work-account",
  name: "Work account",
};

/** An API engine beside the Claude Code engines. */
const LAB: Engine = {
  id: "lab",
  name: "Lab",
  kind: "openai-compatible-api",
  defaultModel: "coder",
  baseUrl: "http://lab",
  key: "",
  models: [{ id: "coder", contextWindow: 32_000 }],
};

beforeEach(async () => {
  // The settings of the test's own: every test file's Starts and estimates read the stored ones.
  const engines = new EngineSettingsForTests({
    engines: [FIRST_CLAUDE_CODE_ENGINE, WORK_ACCOUNT, LAB],
    searchEndpoint: null,
    modelPrices: [],
  });
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: new WorkSettingsForTests() },
    { provide: EngineModels, useValue: new EngineModels(engines) },
  ]);
});

afterEach(async () => {
  await work.app.close();
});

const CHANGED: UsageSettings = {
  measures: ["cost", "tokens"],
  caps: [
    {
      engineId: "lab",
      dailyTokens: 2_000_000,
      dailyDollars: null,
    },
    {
      engineId: "work-account",
      windows: { fiveHour: null, sevenDay: 60 },
      dailyTokens: null,
      dailyDollars: null,
    },
    {
      engineId: "claude-code",
      windows: { fiveHour: 75, sevenDay: null },
      dailyTokens: null,
      dailyDollars: 12.5,
    },
  ],
};

async function readUsageSettings(): Promise<UsageSettings> {
  const response = await sendJson(work, "GET", "/settings/usage");
  return usageSettingsSchema.parse(await response.json());
}

describe("/api/settings/usage", () => {
  it("answers tokens and the 5-hour window ticked, and Window caps at 90% on each Claude Code engine, until saved", async () => {
    expect(await readUsageSettings()).toEqual({
      measures: ["tokens", "fiveHourWindow"],
      caps: [
        {
          engineId: "claude-code",
          windows: { fiveHour: 90, sevenDay: 90 },
          dailyTokens: null,
          dailyDollars: null,
        },
        {
          engineId: "work-account",
          windows: { fiveHour: 90, sevenDay: 90 },
          dailyTokens: null,
          dailyDollars: null,
        },
        { engineId: "lab", dailyTokens: null, dailyDollars: null },
      ],
    });
  });

  it("gives the estimates in the ticked measures alone, and none with no measure ticked", async () => {
    await sendJson(work, "PUT", "/settings/usage", CHANGED);
    const ticked = taskUsageEstimateListSchema.parse(
      await (await sendJson(work, "GET", "/usage-estimates")).json(),
    );
    for (const { usageEstimate } of ticked) {
      for (const engine of usageEstimate.engines) {
        expect(Object.keys(engine)).not.toContain("fiveHourWindow");
      }
    }

    await sendJson(work, "PUT", "/settings/usage", { ...CHANGED, measures: [] });
    const none = await sendJson(work, "GET", "/usage-estimates");

    expect(await none.json()).toEqual([]);
  });
});
