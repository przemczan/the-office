import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { telemetrySettingsSchema, type TelemetrySettings } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { OfficeDataModule } from "../office-data/office-data.module.js";
import { isOwnerOnly } from "../os/owner-only.fixtures.js";
import { BundledGrafana } from "./bundled-grafana/bundled-grafana.js";
import { ScriptedBundledGrafana } from "./bundled-grafana/scripted-bundled-grafana.js";
import { TelemetryHttpModule } from "./telemetry-http.module.js";
import { RunningTelemetrySettings } from "./telemetry-in-effect.js";
import { TELEMETRY_OFF, type TelemetryInEffect } from "./telemetry-settings.js";
import { TelemetryModule } from "./telemetry.module.js";

const SECRET = "Basic c2VjcmV0LXRva2Vu";
const READ_TOKEN = "glsa_c2VjcmV0LXJlYWQ";

const NOT_WANTED = {
  state: "not-wanted",
  address: "http://localhost:3300",
  earlierStopped: [],
} as const;

describe("the telemetry setting's routes", { timeout: 30_000 }, () => {
  let officeData: string | undefined;
  let app: INestApplication | undefined;
  let url: string;
  let grafana: ScriptedBundledGrafana;

  async function start(inEffect: TelemetryInEffect = TELEMETRY_OFF): Promise<void> {
    grafana = new ScriptedBundledGrafana();
    officeData = await mkdtemp(join(tmpdir(), "telemetry-settings-"));
    const started = await startTestApplication({
      imports: [OfficeDataModule.forRoot(officeData), TelemetryModule, TelemetryHttpModule],
      overrides: [
        { provide: RunningTelemetrySettings, useValue: new RunningTelemetrySettings(inEffect) },
        { provide: BundledGrafana, useValue: grafana },
      ],
    });
    app = started.app;
    url = `${started.url}/api/settings/telemetry`;
  }

  afterEach(async () => {
    await app?.close();
    if (officeData) await rm(officeData, { recursive: true, force: true });
    app = undefined;
    officeData = undefined;
  });

  function put(body: unknown): Promise<Response> {
    return fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function settings(): Promise<TelemetrySettings> {
    return telemetrySettingsSchema.parse(await (await fetch(url)).json());
  }

  async function settingsOnceStarted(): Promise<TelemetrySettings> {
    await expect.poll(async () => (await settings()).bundledGrafana.state).not.toBe("starting");
    return settings();
  }

  const filePath = () => join(officeData ?? "", "telemetry.json");

  it("answers off with nothing saved", async () => {
    await start();

    expect(await settings()).toEqual({
      saved: { kind: "off" },
      running: { kind: "off" },
      setByEnvironment: false,
      appliesAtNextStart: false,
      bundledGrafana: NOT_WANTED,
    });
    expect(grafana.calls).toEqual([]);
  });

  it("saves the user's own endpoint owner-only for the next start, never answering a header's value", async () => {
    await start();

    const saved = await put({
      kind: "own-endpoint",
      endpoint: "https://otlp.example.com",
      headers: [{ name: "Authorization", value: SECRET }],
      timeoutMilliseconds: 5_000,
    });
    const text = await saved.text();

    expect(saved.status).toBe(200);
    expect(text).not.toContain(SECRET);
    expect(telemetrySettingsSchema.parse(JSON.parse(text))).toEqual({
      saved: {
        kind: "own-endpoint",
        endpoint: "https://otlp.example.com",
        headerNames: ["Authorization"],
        timeoutMilliseconds: 5_000,
      },
      running: { kind: "off" },
      setByEnvironment: false,
      appliesAtNextStart: true,
      bundledGrafana: NOT_WANTED,
    });
    expect(JSON.stringify(await settings())).not.toContain(SECRET);
    expect(JSON.parse(await readFile(filePath(), "utf8"))).toMatchObject({
      headers: [{ name: "Authorization", value: SECRET }],
    });
    expect(await isOwnerOnly(filePath())).toBe(true);
  });

  it("keeps the saved headers when none are sent, and a saved value sent empty", async () => {
    await start();
    await put({
      kind: "own-endpoint",
      endpoint: "https://otlp.example.com",
      headers: [
        { name: "Authorization", value: SECRET },
        { name: "X-Scope", value: "one" },
      ],
    });

    await put({ kind: "own-endpoint", endpoint: "https://other.example.com" });
    const keptAll = JSON.parse(await readFile(filePath(), "utf8")) as unknown;
    await put({
      kind: "own-endpoint",
      endpoint: "https://other.example.com",
      headers: [{ name: "Authorization", value: "" }],
    });
    const keptOne = JSON.parse(await readFile(filePath(), "utf8")) as unknown;

    expect(keptAll).toMatchObject({
      endpoint: "https://other.example.com",
      headers: [
        { name: "Authorization", value: SECRET },
        { name: "X-Scope", value: "one" },
      ],
    });
    expect(keptOne).toMatchObject({ headers: [{ name: "Authorization", value: SECRET }] });
  });

  it("saves the own Grafana's read token owner-only, never answering it, applying at once", async () => {
    const own = { kind: "own-endpoint", endpoint: "https://otlp.example.com" } as const;
    await start({
      kind: "export",
      endpoint: own.endpoint,
      headers: [],
      timeoutMilliseconds: 10_000,
    });
    await put(own);

    const saved = await put({
      ...own,
      grafana: { readAddress: "https://grafana.example.com", readToken: READ_TOKEN },
    });
    const text = await saved.text();

    expect(saved.status).toBe(200);
    expect(text).not.toContain(READ_TOKEN);
    expect(telemetrySettingsSchema.parse(JSON.parse(text))).toMatchObject({
      saved: { grafana: { readAddress: "https://grafana.example.com", hasReadToken: true } },
      appliesAtNextStart: false,
    });
    expect(JSON.stringify(await settings())).not.toContain(READ_TOKEN);
    expect(JSON.parse(await readFile(filePath(), "utf8"))).toMatchObject({
      grafana: { readToken: READ_TOKEN },
    });
    expect(await isOwnerOnly(filePath())).toBe(true);

    await put({ ...own, grafana: null });

    expect((await settings()).saved).not.toHaveProperty("grafana");
  });

  it("tells that a saved choice which is what runs now applies already", async () => {
    await start({
      kind: "export",
      endpoint: "http://127.0.0.1:4318",
      headers: [],
      timeoutMilliseconds: 2_000,
    });

    const answer = (await (await put({ kind: "bundled-grafana" })).json()) as TelemetrySettings;

    expect(answer).toMatchObject({
      saved: { kind: "bundled-grafana" },
      running: { kind: "exporting", endpoint: "http://127.0.0.1:4318" },
      appliesAtNextStart: false,
    });
  });

  it.each(["ftp://otlp.example.com", "otlp.example.com", ""])(
    "refuses %j as an endpoint with 422, saving nothing",
    async (endpoint) => {
      await start();

      const refused = await put({ kind: "own-endpoint", endpoint });

      expect(refused.status).toBe(422);
      expect(((await refused.json()) as { reasons: string[] }).reasons).toEqual([
        expect.stringContaining("http:// or https://"),
      ]);
      expect((await settings()).saved).toEqual({ kind: "off" });
    },
  );

  it("refuses a header that isn't one with 422", async () => {
    await start();

    const refused = await put({
      kind: "own-endpoint",
      endpoint: "https://otlp.example.com",
      headers: [
        { name: "Bad Name", value: "1" },
        { name: "X-Empty", value: "" },
      ],
    });

    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { reasons: string[] }).reasons).toHaveLength(2);
  });

  it("refuses to save while the environment sets telemetry, and says so", async () => {
    await start({
      kind: "environment",
      endpoint: "http://collector:4318",
      timeoutMilliseconds: 2_000,
    });
    await writeFile(filePath(), JSON.stringify({ kind: "bundled-grafana" }));

    const refused = await put({ kind: "off" });

    expect(refused.status).toBe(409);
    expect(await settings()).toEqual({
      saved: { kind: "bundled-grafana" },
      running: { kind: "exporting", endpoint: "http://collector:4318" },
      setByEnvironment: true,
      appliesAtNextStart: false,
      bundledGrafana: NOT_WANTED,
    });
    expect(JSON.parse(await readFile(filePath(), "utf8"))).toEqual({ kind: "bundled-grafana" });
    expect(grafana.calls).toEqual([]);
  });

  it("takes a file that isn't a setting as nothing saved", async () => {
    await start();
    await writeFile(filePath(), "{ not json");

    expect((await settings()).saved).toEqual({ kind: "off" });
  });

  describe("the bundled Grafana", () => {
    it("starts at once when Bundled Grafana is saved, telling Starting, then Running", async () => {
      await start();
      grafana.holdStarts();

      const answer = telemetrySettingsSchema.parse(
        await (await put({ kind: "bundled-grafana" })).json(),
      );
      expect(answer.bundledGrafana.state).toBe("starting");
      grafana.releaseStarts();

      expect((await settingsOnceStarted()).bundledGrafana).toEqual({
        state: "running",
        address: "http://localhost:3300",
        earlierStopped: [],
      });
      expect(grafana.calls).toContain("start");
    });

    it("stops an earlier bundled Grafana first and names it", async () => {
      await start();
      grafana.earlier = ["the-office-otel-lgtm-1"];

      await put({ kind: "bundled-grafana" });

      expect((await settingsOnceStarted()).bundledGrafana).toMatchObject({
        state: "running",
        earlierStopped: ["the-office-otel-lgtm-1"],
      });
      expect(grafana.stoppedEarlier).toEqual(["the-office-otel-lgtm-1"]);
    });

    it("tells why it couldn't start", async () => {
      await start();
      grafana.failStartWith = { kind: "port-taken" };
      await put({ kind: "bundled-grafana" });

      expect((await settingsOnceStarted()).bundledGrafana).toMatchObject({
        state: "failed",
        problem: expect.stringContaining("port 3300, 4317 or 4318") as unknown,
      });
    });

    it("starts nothing when another choice is saved", async () => {
      await start();

      await put({ kind: "own-endpoint", endpoint: "https://otlp.example.com" });
      await put({ kind: "off" });

      expect((await settings()).bundledGrafana).toEqual(NOT_WANTED);
      expect(grafana.calls).toEqual([]);
    });
  });
});
