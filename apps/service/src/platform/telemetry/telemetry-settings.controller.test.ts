import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { telemetrySettingsSchema, type TelemetrySettings } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { OfficeDataModule } from "../office-data/office-data.module.js";
import { isOwnerOnly } from "../os/owner-only.fixtures.js";
import { TelemetryHttpModule } from "./telemetry-http.module.js";
import { RunningTelemetrySettings } from "./telemetry-in-effect.js";
import { TELEMETRY_OFF, type TelemetryInEffect } from "./telemetry-settings.js";
import { TelemetryModule } from "./telemetry.module.js";

const SECRET = "Basic c2VjcmV0LXRva2Vu";

describe("the telemetry setting's routes", { timeout: 30_000 }, () => {
  let officeData: string | undefined;
  let app: INestApplication | undefined;
  let url: string;

  async function start(inEffect: TelemetryInEffect = TELEMETRY_OFF): Promise<void> {
    officeData = await mkdtemp(join(tmpdir(), "telemetry-settings-"));
    const started = await startTestApplication({
      imports: [OfficeDataModule.forRoot(officeData), TelemetryModule, TelemetryHttpModule],
      overrides: [
        { provide: RunningTelemetrySettings, useValue: new RunningTelemetrySettings(inEffect) },
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

  const filePath = () => join(officeData ?? "", "telemetry.json");

  it("answers off with nothing saved", async () => {
    await start();

    expect(await settings()).toEqual({
      saved: { kind: "off" },
      running: { kind: "off" },
      setByEnvironment: false,
      appliesAtNextStart: false,
    });
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
    });
    expect(JSON.parse(await readFile(filePath(), "utf8"))).toEqual({ kind: "bundled-grafana" });
  });

  it("takes a file that isn't a setting as nothing saved", async () => {
    await start();
    await writeFile(filePath(), "{ not json");

    expect((await settings()).saved).toEqual({ kind: "off" });
  });
});
