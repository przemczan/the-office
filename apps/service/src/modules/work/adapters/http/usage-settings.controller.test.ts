import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usageSettingsSchema, type UsageSettings } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineModels, FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../../../engine/index.js";
import { EngineSettingsForTests } from "../../../engine/index.fixtures.js";
import { UsageSettingsChanged } from "../../domain/office-limit-events.js";
import { WorkSettingsForTests } from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
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
  it("keeps the ticked measures and every engine's caps, in the engines' order, and announces them", async () => {
    const changed = await sendJson(work, "PUT", "/settings/usage", CHANGED);

    expect(changed.status).toBe(200);
    const kept = { measures: CHANGED.measures, caps: CHANGED.caps.toReversed() };
    expect(usageSettingsSchema.parse(await changed.json())).toEqual(kept);
    expect(await readUsageSettings()).toEqual(kept);
    expect(work.published).toEqual([expect.any(UsageSettingsChanged)]);
    expect(webEventsOf(work)).toEqual([{ type: "usage-settings.changed" }]);
  });

  it.each([
    ["a measure ticked twice", { ...CHANGED, measures: ["tokens", "tokens"] }],
    ["an engine left out", { ...CHANGED, caps: CHANGED.caps.slice(1) }],
    ["an engine named twice", { ...CHANGED, caps: [...CHANGED.caps, CHANGED.caps[1]] }],
    [
      "an engine it doesn't list",
      { ...CHANGED, caps: [...CHANGED.caps, { ...CHANGED.caps[0], engineId: "strata" }] },
    ],
    [
      "Window caps on an API engine",
      {
        ...CHANGED,
        caps: CHANGED.caps.map((caps) => ({ ...caps, windows: { fiveHour: 50, sevenDay: 50 } })),
      },
    ],
    [
      "no Window caps on a Claude Code engine",
      {
        ...CHANGED,
        caps: CHANGED.caps.map(({ windows, ...caps }) =>
          caps.engineId === "work-account" ? caps : { ...caps, windows },
        ),
      },
    ],
    [
      "a Window cap over 100%",
      {
        ...CHANGED,
        caps: [
          CHANGED.caps[0],
          CHANGED.caps[1],
          { ...CHANGED.caps[2], windows: { fiveHour: 101, sevenDay: null } },
        ],
      },
    ],
    [
      "a Daily cap of 0 tokens",
      { ...CHANGED, caps: [{ ...CHANGED.caps[0], dailyTokens: 0 }, ...CHANGED.caps.slice(1)] },
    ],
  ])("refuses %s", async (_case, settings) => {
    const refused = await sendJson(work, "PUT", "/settings/usage", settings);

    expect(refused.status).toBe(400);
    expect(work.published).toEqual([]);
  });
});
