import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TelemetryChoice } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { BUNDLED_GRAFANA_READ_ADDRESS } from "../../../../platform/telemetry/bundled-grafana/bundled-grafana.js";
import { BundledGrafanaKeeper } from "../../../../platform/telemetry/bundled-grafana/bundled-grafana-keeper.js";
import { ScriptedBundledGrafana } from "../../../../platform/telemetry/bundled-grafana/scripted-bundled-grafana.js";
import { SavedTelemetrySetting } from "../../../../platform/telemetry/saved-telemetry-setting.js";
import { RunningTelemetrySettings } from "../../../../platform/telemetry/telemetry-in-effect.js";
import {
  TELEMETRY_OFF,
  type TelemetryInEffect,
} from "../../../../platform/telemetry/telemetry-settings.js";
import { SettingsGrafanaInUse } from "./settings-grafana-in-use.js";

const BUNDLED: TelemetryChoice = { kind: "bundled-grafana" };
const OWN_WITH_GRAFANA: TelemetryChoice = {
  kind: "own-endpoint",
  endpoint: "https://otlp.example.com",
  grafana: { readAddress: "https://grafana.example.com", readToken: "glsa_read" },
};
const SET_BY_ENVIRONMENT: TelemetryInEffect = {
  kind: "environment",
  endpoint: "http://collector:4318",
  timeoutMilliseconds: 2_000,
};

describe("SettingsGrafanaInUse", () => {
  let officeData: string | undefined;

  afterEach(async () => {
    if (officeData) await rm(officeData, { recursive: true, force: true });
    officeData = undefined;
  });

  async function inUseWith(
    saved: TelemetryChoice | undefined,
    inEffect: TelemetryInEffect = TELEMETRY_OFF,
  ): Promise<{
    inUse: SettingsGrafanaInUse;
    keeper: BundledGrafanaKeeper;
    grafana: ScriptedBundledGrafana;
  }> {
    officeData = await mkdtemp(join(tmpdir(), "settings-grafana-in-use-"));
    const setting = new SavedTelemetrySetting(new OfficeDataDirectory(officeData));
    if (saved) await setting.change(() => saved);
    const grafana = new ScriptedBundledGrafana();
    const running = new RunningTelemetrySettings(inEffect);
    const keeper = new BundledGrafanaKeeper(grafana, setting, running);
    return { inUse: new SettingsGrafanaInUse(setting, keeper, running), keeper, grafana };
  }

  it.each<TelemetryChoice | undefined>([
    undefined,
    { kind: "off" },
    { kind: "own-endpoint", endpoint: "https://otlp.example.com" },
  ])("is none while %j is saved, with no Grafana read address", async (saved) => {
    const { inUse } = await inUseWith(saved);

    expect(await inUse.now()).toEqual({ kind: "none" });
  });

  it("is none while the environment sets telemetry, though Bundled Grafana is saved", async () => {
    const { inUse, grafana } = await inUseWith(BUNDLED, SET_BY_ENVIRONMENT);
    grafana.runState = "running";

    expect(await inUse.now()).toEqual({ kind: "none" });
  });

  it("is starting at the read address while it starts", async () => {
    const { inUse, keeper, grafana } = await inUseWith(BUNDLED);
    grafana.holdStarts();
    const started = keeper.start();

    expect(await inUse.now()).toEqual({ kind: "starting", address: BUNDLED_GRAFANA_READ_ADDRESS });

    grafana.releaseStarts();
    await started;
  });

  it("is failed with the problem once it couldn't start", async () => {
    const { inUse, keeper, grafana } = await inUseWith(BUNDLED);
    grafana.failStartWith = { kind: "port-taken" };
    await keeper.start();

    expect(await inUse.now()).toEqual({
      kind: "failed",
      address: BUNDLED_GRAFANA_READ_ADDRESS,
      problem: "Another program on this machine holds port 3300, 4317 or 4318.",
    });
  });

  it("is ready to read at the read address, with no token, once it runs", async () => {
    const { inUse, grafana } = await inUseWith(BUNDLED);
    grafana.runState = "running";

    expect(await inUse.now()).toEqual({
      kind: "ready",
      access: { address: "http://127.0.0.1:3300" },
    });
  });

  it("is the user's own Grafana, read with its read token, while their endpoint names one", async () => {
    const { inUse } = await inUseWith(OWN_WITH_GRAFANA);

    expect(await inUse.now()).toEqual({
      kind: "ready",
      access: { address: "https://grafana.example.com", token: "glsa_read" },
    });
    expect(await inUse.savedReadToken()).toBe("glsa_read");
  });

  it("reads the user's own Grafana with no token when none is saved", async () => {
    const { inUse } = await inUseWith({
      kind: "own-endpoint",
      endpoint: "https://otlp.example.com",
      grafana: { readAddress: "https://grafana.example.com" },
    });

    expect(await inUse.now()).toEqual({
      kind: "ready",
      access: { address: "https://grafana.example.com" },
    });
    expect(await inUse.savedReadToken()).toBeUndefined();
  });

  it("is none while the environment sets telemetry, though the user's own Grafana is saved", async () => {
    const { inUse } = await inUseWith(OWN_WITH_GRAFANA, SET_BY_ENVIRONMENT);

    expect(await inUse.now()).toEqual({ kind: "none" });
  });

  it("reads a newly saved Grafana at once", async () => {
    const { inUse } = await inUseWith({ kind: "off" });
    const setting = new SavedTelemetrySetting(new OfficeDataDirectory(officeData ?? ""));

    await setting.change(() => OWN_WITH_GRAFANA);

    expect(await inUse.now()).toMatchObject({ kind: "ready" });
  });
});
