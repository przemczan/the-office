import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module, type INestApplication } from "@nestjs/common";
import {
  CHECK_GRAFANA_ACTION,
  SAVE_TELEMETRY_ACTION,
  START_BUNDLED_GRAFANA_ACTION,
  telemetrySettingsSchema,
  type OfficeAction,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { BundledGrafana } from "../../../../platform/telemetry/bundled-grafana/bundled-grafana.js";
import { ScriptedBundledGrafana } from "../../../../platform/telemetry/bundled-grafana/scripted-bundled-grafana.js";
import { TelemetryHttpModule } from "../../../../platform/telemetry/telemetry-http.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import {
  EngineModule,
  OfficeToolRegistry,
  ScriptedEngine,
  ScriptedEngineModule,
} from "../../../engine/index.js";
import { GrafanaCheck } from "../../application/grafana-check.js";
import { GrafanaInUse } from "../../ports/grafana-in-use.js";
import { StatsSource } from "../../ports/stats-source.js";
import { TelemetryOfficeActionsController } from "../http/telemetry-office-actions.controller.js";
import { ScriptedStatsSource } from "../scripted/scripted-stats-source.js";
import { TelemetryOfficeActions } from "./telemetry-office-actions.js";

const SAVED_ADDRESS = "http://saved.example.com:3000";
const SAVED_TOKEN = "saved-token";

const grafanaInUse = {
  now: () => Promise.resolve({ kind: "none" as const }),
  savedReadToken: () => Promise.resolve(SAVED_TOKEN),
  savedReadAddress: () => Promise.resolve(SAVED_ADDRESS),
};

@Module({
  imports: [TelemetryHttpModule, EngineModule],
  controllers: [TelemetryOfficeActionsController],
  providers: [
    GrafanaCheck,
    TelemetryOfficeActions,
    { provide: GrafanaInUse, useValue: grafanaInUse },
    { provide: StatsSource, useClass: ScriptedStatsSource },
  ],
})
class TelemetryActionsForTests {}

let officeData: string;
let app: INestApplication;
let url: string;
let grafana: ScriptedBundledGrafana;

beforeEach(async () => {
  grafana = new ScriptedBundledGrafana();
  officeData = await mkdtemp(join(tmpdir(), "telemetry-office-actions-"));
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      OfficeDataModule.forRoot(officeData),
      TelemetryModule,
      TelemetryActionsForTests,
    ],
    moduleOverrides: [
      { module: EngineModule, useModule: ScriptedEngineModule.register(new ScriptedEngine([])) },
    ],
    overrides: [{ provide: BundledGrafana, useValue: grafana }],
  }));
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

function accessesRead(): unknown[] {
  return (app.get(StatsSource) as ScriptedStatsSource).calls
    .filter((call) => call.kind === "data-sources")
    .map((call) => call.access);
}

function tool(action: OfficeAction) {
  const [found] = app.get(OfficeToolRegistry).named([action.name], RUN_EVERY_CALL);
  if (!found) throw new Error(`${action.name} is not registered.`);
  return found;
}

function runTool(action: OfficeAction, input: unknown) {
  const found = tool(action);
  return found.run(found.input.parse(input), anOfficeToolCall("session-1"));
}

async function saveBundledGrafana(): Promise<void> {
  await fetch(`${url}/api/settings/telemetry`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "bundled-grafana" }),
  });
  await expect
    .poll(async () => {
      const settings = telemetrySettingsSchema.parse(
        await (await fetch(`${url}/api/settings/telemetry`)).json(),
      );
      return settings.bundledGrafana.state;
    })
    .not.toBe("starting");
}

describe("check_grafana", () => {
  it("sends a person's check the saved read token only to the saved read address", async () => {
    const result = await runTool(CHECK_GRAFANA_ACTION, { readAddress: ` ${SAVED_ADDRESS} ` });

    expect(result.isError).toBe(false);
    expect(accessesRead()).toEqual([{ address: SAVED_ADDRESS, token: SAVED_TOKEN }]);
  });

  it("never sends the saved read token to another address a person names", async () => {
    const result = await runTool(CHECK_GRAFANA_ACTION, {
      readAddress: "https://attacker.example.com",
    });

    expect(result.isError).toBe(false);
    expect(accessesRead()).toEqual([{ address: "https://attacker.example.com" }]);
  });

  it("refuses a read token in a person's check, asking nothing", async () => {
    const result = await runTool(CHECK_GRAFANA_ACTION, {
      readAddress: SAVED_ADDRESS,
      readToken: "glsa_given",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Only the user can give a read token");
    expect(accessesRead()).toEqual([]);
  });

  it("keeps the user's route as it was: the saved token goes to the address the user names", async () => {
    const response = await fetch(`${url}/api/stats/grafana-check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ readAddress: "https://other.example.com" }),
    });

    expect(response.status).toBe(200);
    expect(accessesRead()).toEqual([{ address: "https://other.example.com", token: SAVED_TOKEN }]);
  });
});

describe("start_bundled_grafana", () => {
  it("starts it again, through the route and through its tool", async () => {
    grafana.failStartWith = { kind: "port-taken" };
    await saveBundledGrafana();
    grafana.failStartWith = undefined;

    const retried = await fetch(`${url}/api/settings/telemetry/bundled-grafana/start`, {
      method: "POST",
    });
    expect(retried.status).toBe(200);
    await expect.poll(() => grafana.calls.filter((call) => call === "start").length).toBe(2);

    const result = await runTool(START_BUNDLED_GRAFANA_ACTION, {});
    expect(result.isError).toBe(false);
    expect(result.text).toContain("starting again");
    await expect.poll(() => grafana.calls.filter((call) => call === "start").length).toBe(3);
  });

  it("is refused, by the route and by the tool, while Bundled Grafana isn't saved", async () => {
    const refused = await fetch(`${url}/api/settings/telemetry/bundled-grafana/start`, {
      method: "POST",
    });
    const result = await runTool(START_BUNDLED_GRAFANA_ACTION, {});

    expect(refused.status).toBe(409);
    expect(result.isError).toBe(true);
    expect(grafana.calls).toEqual([]);
  });
});

describe("save_telemetry", () => {
  const HEADER_VALUE = "Basic c2F2ZWQtc2VjcmV0";
  const READ_TOKEN = "glsa_saved_read_token";
  const own = {
    kind: "own-endpoint",
    endpoint: "https://otlp.example.com",
    headers: [{ name: "Authorization", value: HEADER_VALUE }],
    grafana: { readAddress: "https://grafana.example.com", readToken: READ_TOKEN },
  };

  it("keeps the user's route as it was: the credentials are saved and never answered", async () => {
    const saved = await put(own);

    expect(saved.status).toBe(200);
    const body = await saved.text();
    expect(body).not.toContain(HEADER_VALUE);
    expect(body).not.toContain(READ_TOKEN);
    telemetrySettingsSchema.parse(JSON.parse(body));
    expect(await savedFile()).toMatchObject({
      headers: [{ name: "Authorization", value: HEADER_VALUE }],
      grafana: { readToken: READ_TOKEN },
    });
    expect((await put({ kind: "own-endpoint" })).status).toBe(400);
  });

  it("changes the choice for a person while the saved header values and read token stay as they are", async () => {
    await put(own);

    const result = await runTool(SAVE_TELEMETRY_ACTION, {
      kind: "own-endpoint",
      endpoint: "https://otlp.example.com",
      timeoutMilliseconds: 5000,
      grafana: { readAddress: "https://grafana.example.com" },
    });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("https://otlp.example.com");
    expect(result.text).not.toContain(HEADER_VALUE);
    expect(result.text).not.toContain(READ_TOKEN);
    expect(await savedFile()).toMatchObject({
      endpoint: "https://otlp.example.com",
      timeoutMilliseconds: 5000,
      headers: [{ name: "Authorization", value: HEADER_VALUE }],
      grafana: { readAddress: "https://grafana.example.com", readToken: READ_TOKEN },
    });
  });

  it("refuses a person's call that gives a header or a read token, up front and when run, changing nothing", async () => {
    await put(own);
    const before = await savedFile();
    const calls = [
      { kind: "own-endpoint", endpoint: "https://x.example.com", headers: [] },
      {
        kind: "own-endpoint",
        endpoint: "https://x.example.com",
        grafana: { readAddress: "https://g.example.com", readToken: "given" },
      },
    ];

    for (const call of calls) {
      const found = tool(SAVE_TELEMETRY_ACTION);
      const input = found.input.parse(call);
      expect(await found.authority?.check?.(input, anOfficeToolCall("session-1"))).toContain(
        "the user's alone",
      );
      const result = await runTool(SAVE_TELEMETRY_ACTION, call);
      expect(result.isError).toBe(true);
      expect(result.text).toContain("the user's alone");
    }
    expect(await savedFile()).toEqual(before);
  });

  it("refuses a person's call that moves a saved credential to another address, changing nothing", async () => {
    await put(own);
    const before = await savedFile();
    const calls = [
      { kind: "own-endpoint", endpoint: "https://attacker.example.com" },
      {
        kind: "own-endpoint",
        endpoint: "https://otlp.example.com",
        grafana: { readAddress: "https://attacker.example.com" },
      },
    ];

    for (const call of calls) {
      const result = await runTool(SAVE_TELEMETRY_ACTION, call);
      expect(result.isError).toBe(true);
      expect(result.text).toContain("go only to the address they were saved with");
    }
    expect(await savedFile()).toEqual(before);
  });

  it("drafts a person's call without a credential, and applies it as the same call", async () => {
    await put(own);
    const found = tool(SAVE_TELEMETRY_ACTION);
    const input = found.input.parse({
      kind: "own-endpoint",
      endpoint: "https://otlp.example.com",
      grafana: { readAddress: "https://grafana.example.com", readToken: READ_TOKEN },
    });

    const shown = JSON.stringify(await found.draft?.(input));
    expect(shown).not.toContain(READ_TOKEN);
    expect(shown).not.toContain(HEADER_VALUE);

    const applied = await found.applyFor?.(
      found.input.parse({
        kind: "own-endpoint",
        endpoint: "https://otlp.example.com",
        timeoutMilliseconds: 7000,
      }),
      { user: { id: "u", name: "U" }, proposedBy: "developer" } as never,
    );
    expect(applied?.isError).toBe(false);
    expect(await savedFile()).toMatchObject({
      endpoint: "https://otlp.example.com",
      timeoutMilliseconds: 7000,
      headers: [{ name: "Authorization", value: HEADER_VALUE }],
    });
  });
});

function put(body: unknown): Promise<Response> {
  return fetch(`${url}/api/settings/telemetry`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function savedFile(): Promise<{ [key: string]: unknown }> {
  return JSON.parse(await readFile(join(officeData, "telemetry.json"), "utf8"));
}
