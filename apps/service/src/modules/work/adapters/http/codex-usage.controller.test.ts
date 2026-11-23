import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startAnswerSchema,
  usageSettingsSchema,
  type Task,
  type UsageSettings,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineModels, FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../../../engine/index.js";
import { CodexApiKey, EngineSettingsForTests } from "../../../engine/index.fixtures.js";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import {
  KnownEngineCascadeForTests,
  WorkSettingsForTests,
} from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { HOUR, tasksHttp } from "../../tasks.controller.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { ownProjectsQueue } from "../postgres/postgres-queue-repository.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** The test's own Project: every test file shares the database. */
let projectId: string;

/** A Codex engine signed in with ChatGPT, whose plan gives usage windows. */
const CODEX: Engine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
  apiKey: null,
};

/** A Codex engine signed in by an OpenAI API key, which has no windows. */
const CODEX_ON_A_KEY: Engine = { ...CODEX, id: "codex-api", name: "Codex API" };

const { readTask, requestStart, ownProjectTasks, estimatedTask, windowRead, newReading } =
  tasksHttp(() => ({ work, projectId }));

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "codex-usage-http-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  projectId = `project-${randomUUID()}`;
  // The settings of the test's own: every test file's Starts and estimates read the stored ones.
  const engines = new EngineSettingsForTests({
    engines: [FIRST_CLAUDE_CODE_ENGINE, CODEX, CODEX_ON_A_KEY],
    searchEndpoint: null,
    modelPrices: [],
  });
  // "Use an API key instead" keeps the key so.
  await engines.setCodexApiKey(CODEX_ON_A_KEY.id, CodexApiKey.of("sk-test"));
  work = await startWorkApplication(officeData, [
    { provide: WorkSettings, useValue: new WorkSettingsForTests() },
    { provide: EngineModels, useValue: new EngineModels(engines) },
    ownProjectsQueue(() => [projectId]),
    ownProjectTasks(),
  ]);
  // Every Role of the test's Project runs on the ChatGPT-signed Codex engine.
  work.app
    .get(KnownEngineCascadeForTests)
    .inProject.set(projectId, { engineId: CODEX.id, model: "gpt-6-luna" });
});

afterEach(async () => {
  await work.app.close();
});

/** Caps that fit: Window caps on the engines with windows, Daily caps alone on the one on a key. */
const FITTING: UsageSettings = {
  measures: ["tokens", "fiveHourWindow"],
  caps: [
    {
      engineId: "claude-code",
      windows: { fiveHour: 90, sevenDay: 90 },
      dailyTokens: null,
      dailyDollars: null,
    },
    {
      engineId: "codex",
      windows: { fiveHour: 75, sevenDay: null },
      dailyTokens: null,
      dailyDollars: null,
    },
    { engineId: "codex-api", dailyTokens: 2_000_000, dailyDollars: null },
  ],
};

const WINDOW_CAPS_WORDS =
  "caps: Window caps are on each engine whose account has usage windows, and on no other.";

describe("/api/settings/usage on Codex engines", () => {
  it("answers Window caps at 90% on a Codex engine signed in with ChatGPT, and Daily caps alone on one on an API key, until saved", async () => {
    const response = await sendJson(work, "GET", "/settings/usage");

    expect(usageSettingsSchema.parse(await response.json()).caps).toEqual([
      {
        engineId: "claude-code",
        windows: { fiveHour: 90, sevenDay: 90 },
        dailyTokens: null,
        dailyDollars: null,
      },
      {
        engineId: "codex",
        windows: { fiveHour: 90, sevenDay: 90 },
        dailyTokens: null,
        dailyDollars: null,
      },
      { engineId: "codex-api", dailyTokens: null, dailyDollars: null },
    ]);
  });

  it("keeps Window caps on a Codex engine signed in with ChatGPT", async () => {
    const changed = await sendJson(work, "PUT", "/settings/usage", FITTING);

    expect(changed.status).toBe(200);
    expect(usageSettingsSchema.parse(await changed.json())).toEqual(FITTING);
  });

  it.each([
    [
      "Window caps on a Codex engine on an API key",
      FITTING.caps.map((caps) =>
        caps.engineId === "codex-api" ? { ...caps, windows: { fiveHour: 50, sevenDay: 50 } } : caps,
      ),
    ],
    [
      "no Window caps on a Codex engine signed in with ChatGPT",
      FITTING.caps.map(({ windows, ...caps }) =>
        caps.engineId === "codex" ? caps : { ...caps, windows },
      ),
    ],
  ])("refuses %s", async (_case, caps) => {
    const refused = await sendJson(work, "PUT", "/settings/usage", { ...FITTING, caps });

    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ message: WINDOW_CAPS_WORDS });
    expect(work.published).toEqual([]);
  });
});

describe("Window caps on a Codex engine", () => {
  const ownIds: string[] = [];

  afterEach(async () => {
    (work.app.get(Schedule) as ManualSchedule).followSystemTime();
    for (const id of ownIds.splice(0)) await sendJson(work, "POST", `/tasks/${id}/drop`);
  });

  /** A Ready Task expected to use 6% of the Codex engine's 5-hour window, by the Planner's tokens. */
  async function sixPercentTask(): Promise<Task> {
    const task = await estimatedTask(60_000);
    ownIds.push(task.id);
    return task;
  }

  it("holds a Start its default 90% cap would pass, and starts it on the next reading", async () => {
    await windowRead(80, 3 * HOUR, CODEX.id);
    const first = await sixPercentTask();
    const second = await sixPercentTask();

    await requestStart(first.id);
    const answer = startAnswerSchema.parse(await (await requestStart(second.id)).json());

    expect((await readTask(first.id)).state).toBe("in-progress");
    expect(answer.queued?.reasons).toEqual([
      expect.stringMatching(
        /^The Codex engine's 5-hour window would pass its 90% cap: 80% used, 6% expected of the Tasks started since it was read and 6% of this Task\. It resets (on \w{3} \d{1,2} \w{3} )?at \d\d:\d\d\.$/,
      ),
    ]);

    await newReading(CODEX.id);

    expect((await readTask(second.id)).state).toBe("in-progress");
  });

  it("weighs no window of the Codex engine's on a Task whose Roles run on the one on an API key", async () => {
    work.app
      .get(KnownEngineCascadeForTests)
      .inProject.set(projectId, { engineId: CODEX_ON_A_KEY.id, model: "gpt-6-luna" });
    await windowRead(99, 3 * HOUR, CODEX_ON_A_KEY.id);
    const task = await sixPercentTask();

    await requestStart(task.id);

    expect((await readTask(task.id)).state).toBe("in-progress");
  });
});
