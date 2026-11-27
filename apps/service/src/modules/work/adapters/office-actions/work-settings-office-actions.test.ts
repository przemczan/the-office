import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SET_ARCHIVE_PERIOD_ACTION,
  SET_OFFICE_WIDE_LIMIT_ACTION,
  SET_USAGE_SETTINGS_ACTION,
  type UsageSettings,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  anOfficeToolCall,
  EngineSettingsForTests,
  RUN_EVERY_CALL,
} from "../../../engine/index.fixtures.js";
import {
  EngineModels,
  FIRST_CLAUDE_CODE_ENGINE,
  OfficeToolRegistry,
  type OfficeTool,
} from "../../../engine/index.js";
import { OfficeLimits } from "../../application/office-limits.js";
import { WorkSettingsForTests } from "../../ports/work-ports.fixtures.js";
import { WorkSettings } from "../../ports/work-settings.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";

const USER = { userId: "user-ann", name: "Ann Lee" };
const APPLICATION = { user: USER, proposedBy: "cto" };

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "work-settings-actions-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  const engines = new EngineSettingsForTests({
    engines: [FIRST_CLAUDE_CODE_ENGINE],
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

async function readUsage(): Promise<UsageSettings> {
  return (await sendJson(work, "GET", "/settings/usage")).json() as Promise<UsageSettings>;
}

function toolOf(name: string): OfficeTool {
  const [tool] = work.app.get(OfficeToolRegistry).named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool;
}

function callTool(name: string, input: Record<string, unknown>) {
  const tool = toolOf(name);
  return tool.run(tool.input.parse(input), anOfficeToolCall("session-1"));
}

describe("set_office_wide_limit", () => {
  it("is carried out by a person's call, in words, and by the route alike", async () => {
    const result = await callTool(SET_OFFICE_WIDE_LIMIT_ACTION.name, { officeWideLimit: 4 });

    expect(result).toMatchObject({ isError: false });
    expect(result.text).toContain("4 Tasks");
    expect(await work.app.get(OfficeLimits).officeWideLimit()).toBe(4);
    const routed = await sendJson(work, "PUT", "/settings/office-wide-limit", {
      officeWideLimit: 5,
    });
    expect(await routed.json()).toEqual({ officeWideLimit: 5 });
  });

  it("drafts the limit beside the one in force, applies it and then reads stale", async () => {
    const tool = toolOf(SET_OFFICE_WIDE_LIMIT_ACTION.name);
    const input = tool.input.parse({ officeWideLimit: 4 });

    const draft = await tool.draft?.(input);

    expect(draft?.subject).toMatchObject({ kind: "office-setting", id: "office-wide-limit" });
    expect(draft?.subject.title).toBe("Office-wide limit");
    expect(draft?.fields).toMatchObject([{ before: "3", after: "4" }]);
    expect(await tool.applyFor?.(input, APPLICATION)).toMatchObject({ isError: false });
    expect(await work.app.get(OfficeLimits).officeWideLimit()).toBe(4);
    expect((await tool.draft?.(input))?.fingerprint).not.toEqual(draft?.fingerprint);
  });
});

describe("set_archive_period", () => {
  it("is carried out by a person's call, in words", async () => {
    const result = await callTool(SET_ARCHIVE_PERIOD_ACTION.name, { archivePeriod: 14 });

    expect(result).toMatchObject({ isError: false });
    expect(result.text).toContain("14 days");
    expect(await work.app.get(OfficeLimits).archivePeriod()).toBe(14);
  });

  it("drafts the period beside the one in force and applies it for the user", async () => {
    const tool = toolOf(SET_ARCHIVE_PERIOD_ACTION.name);
    const input = tool.input.parse({ archivePeriod: 14 });

    const draft = await tool.draft?.(input);

    expect(draft?.subject.title).toBe("Archive period");
    expect(draft?.fields).toMatchObject([{ before: "30", after: "14" }]);
    expect(await tool.applyFor?.(input, APPLICATION)).toMatchObject({ isError: false });
    expect(await work.app.get(OfficeLimits).archivePeriod()).toBe(14);
  });
});

describe("set_usage_settings", () => {
  const CAPS = { engineId: "claude-code", dailyTokens: null, dailyDollars: 12.5 };

  it("keeps the measures and caps for a person's call", async () => {
    const current = await readUsage();
    const caps = current.caps.map((each) => ({ ...each, ...CAPS }));

    const result = await callTool(SET_USAGE_SETTINGS_ACTION.name, { measures: ["cost"], caps });

    expect(result).toMatchObject({ isError: false });
    expect((await readUsage()).measures).toEqual(["cost"]);
  });

  it("answers caps that don't fit the engines in words, as the route answers 400, and saves nothing", async () => {
    const before = await readUsage();
    const body = { measures: ["cost"], caps: [] };

    const result = await callTool(SET_USAGE_SETTINGS_ACTION.name, body);
    const routed = await sendJson(work, "PUT", "/settings/usage", body);

    expect(result).toMatchObject({ isError: true });
    expect(result.text).toBe("caps: Every engine has its caps, once.");
    expect(routed.status).toBe(400);
    expect(((await routed.json()) as { message: string }).message).toBe(result.text);
    expect(await readUsage()).toEqual(before);
  });

  it("drafts the measures beside those in force and applies them for the user", async () => {
    const tool = toolOf(SET_USAGE_SETTINGS_ACTION.name);
    const current = await readUsage();
    const input = tool.input.parse({ measures: ["tokens"], caps: current.caps });

    const draft = await tool.draft?.(input);

    expect(draft?.subject).toMatchObject({ kind: "office-setting", id: "usage" });
    expect(draft?.fields.find(({ label }) => label === "Measures")).toMatchObject({
      after: "tokens",
    });
    expect(await tool.applyFor?.(input, APPLICATION)).toMatchObject({ isError: false });
    expect((await readUsage()).measures).toEqual(["tokens"]);
  });
});
