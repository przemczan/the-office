import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { DEFAULT_ENGINE_SETTINGS } from "../../domain/engine-settings.js";
import { FIRST_CLAUDE_CODE_ENGINE, type CodexEngine } from "../../domain/engines.js";
import { PostgresEngineSettings } from "./postgres-engine-settings.js";
import { PostgresWindowStarts } from "./postgres-window-starts.js";

// A database of the file's own: a Save of the engine settings deletes the Window start of every
// engine it doesn't list, which on the shared database would be another test's.
let database: FreshTestDatabase;
let app: INestApplication;
let windowStarts: PostgresWindowStarts;
let settings: PostgresEngineSettings;

beforeAll(async () => {
  database = await freshTestDatabase();
  ({ app } = await startTestApplication({
    database: { url: database.url },
    providers: [PostgresWindowStarts, PostgresEngineSettings],
  }));
  windowStarts = app.get(PostgresWindowStarts);
  settings = app.get(PostgresEngineSettings);
}, 60_000);

afterAll(async () => {
  await app.close();
  await database.drop();
});

const CODEX: CodexEngine = {
  id: "codex",
  name: "Codex",
  kind: "codex",
  defaultModel: "gpt-5.6-terra",
  defaultEffort: null,
  apiKey: null,
};

const AT = new Date("2026-11-23T07:00:00.000Z");

describe("PostgresWindowStarts", () => {
  it("keeps none until set, then the settings, each record without touching them", async () => {
    expect(await windowStarts.of("never-set")).toBeUndefined();

    await windowStarts.saveSettings("kept", {
      startAtTimes: ["07:00", "12:30"],
      startAfterReset: true,
    });
    expect(await windowStarts.of("kept")).toEqual({
      engineId: "kept",
      startAtTimes: ["07:00", "12:30"],
      startAfterReset: true,
      last: undefined,
    });

    const resetsAt = new Date("2026-11-23T12:00:00.000Z");
    await windowStarts.record("kept", {
      at: AT,
      outcome: "started",
      trigger: "set-time",
      fiveHourResetsAt: resetsAt,
    });
    expect((await windowStarts.of("kept"))?.last).toEqual({
      at: AT,
      outcome: "started",
      trigger: "set-time",
      fiveHourResetsAt: resetsAt,
    });

    await windowStarts.record("kept", {
      at: AT,
      outcome: "skipped",
      trigger: "after-reset",
      reason: "weekly-nearly-used-up",
    });
    await windowStarts.saveSettings("kept", { startAtTimes: [], startAfterReset: false });
    expect(await windowStarts.of("kept")).toEqual({
      engineId: "kept",
      startAtTimes: [],
      startAfterReset: false,
      last: { at: AT, outcome: "skipped", trigger: "after-reset", reason: "weekly-nearly-used-up" },
    });
  });

  it("records on an engine never set with the settings' defaults, and lists every kept one", async () => {
    await windowStarts.record("recorded-first", {
      at: AT,
      outcome: "failed",
      trigger: "set-time",
      error: "The engine didn't answer.",
    });

    expect(await windowStarts.of("recorded-first")).toEqual({
      engineId: "recorded-first",
      startAtTimes: [],
      startAfterReset: false,
      last: { at: AT, outcome: "failed", trigger: "set-time", error: "The engine didn't answer." },
    });
    expect((await windowStarts.all()).map(({ engineId }) => engineId)).toContain("recorded-first");
  });

  it("keeps a listed engine's Window start through a Save of the settings, and deletes a removed one's", async () => {
    const listed = { ...DEFAULT_ENGINE_SETTINGS, engines: [FIRST_CLAUDE_CODE_ENGINE, CODEX] };
    await settings.replace(listed);
    await windowStarts.saveSettings("codex", { startAtTimes: ["06:00"], startAfterReset: false });
    await windowStarts.saveSettings("claude-code", { startAtTimes: [], startAfterReset: true });

    await settings.replace({ ...listed, askBeforeSwitchAbove: 5_000 });
    expect((await settings.read()).engines.map(({ id }) => id)).toEqual(["claude-code", "codex"]);
    expect(await windowStarts.of("codex")).toMatchObject({ startAtTimes: ["06:00"] });

    await settings.replace({ ...listed, engines: [FIRST_CLAUDE_CODE_ENGINE] });
    expect(await windowStarts.of("codex")).toBeUndefined();
    expect(await windowStarts.of("claude-code")).toMatchObject({ startAfterReset: true });

    await settings.replace({ ...DEFAULT_ENGINE_SETTINGS, engines: [], officeDefault: null });
    expect(await windowStarts.all()).toEqual([]);
  });
});
