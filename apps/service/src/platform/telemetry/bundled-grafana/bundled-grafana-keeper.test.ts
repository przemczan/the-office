import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TelemetryChoice } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../office-data/office-data-directory.js";
import { SavedTelemetrySetting } from "../saved-telemetry-setting.js";
import { RunningTelemetrySettings } from "../telemetry-in-effect.js";
import { TELEMETRY_OFF, type TelemetryInEffect } from "../telemetry-settings.js";
import { BundledGrafanaKeeper } from "./bundled-grafana-keeper.js";
import { ScriptedBundledGrafana } from "./scripted-bundled-grafana.js";

const EXPORTING_TO_BUNDLED: TelemetryInEffect = {
  kind: "export",
  endpoint: "http://127.0.0.1:4318",
  headers: [],
  timeoutMilliseconds: 2_000,
};
const SET_BY_ENVIRONMENT: TelemetryInEffect = {
  kind: "environment",
  endpoint: "http://collector:4318",
  timeoutMilliseconds: 2_000,
};
const ENVIRONMENT_OFF: TelemetryInEffect = { kind: "off", setByEnvironment: true };

describe("BundledGrafanaKeeper", () => {
  let officeData: string | undefined;

  afterEach(async () => {
    if (officeData) await rm(officeData, { recursive: true, force: true });
    officeData = undefined;
  });

  async function keeperWith(
    saved: TelemetryChoice | undefined,
    inEffect: TelemetryInEffect = TELEMETRY_OFF,
  ): Promise<{ keeper: BundledGrafanaKeeper; grafana: ScriptedBundledGrafana }> {
    officeData = await mkdtemp(join(tmpdir(), "bundled-grafana-keeper-"));
    const setting = new SavedTelemetrySetting(new OfficeDataDirectory(officeData));
    if (saved) await setting.change(() => saved);
    const grafana = new ScriptedBundledGrafana();
    const keeper = new BundledGrafanaKeeper(
      grafana,
      setting,
      new RunningTelemetrySettings(inEffect),
    );
    return { keeper, grafana };
  }

  describe("at The Office's start", () => {
    it("starts it while Bundled Grafana is saved", async () => {
      const { keeper, grafana } = await keeperWith({ kind: "bundled-grafana" });

      await keeper.keepAtStart();

      expect(grafana.calls).toEqual(["earlierContainers", "start"]);
      expect(grafana.runState).toBe("running");
    });

    it("starts it while this run exports to it, though another choice is saved", async () => {
      const { keeper, grafana } = await keeperWith({ kind: "off" }, EXPORTING_TO_BUNDLED);

      await keeper.keepAtStart();

      expect(grafana.runState).toBe("running");
    });

    it.each<TelemetryChoice | undefined>([
      undefined,
      { kind: "off" },
      { kind: "own-endpoint", endpoint: "https://otlp.example.com" },
    ])("stops The Office's own, keeping it, when %j is saved", async (saved) => {
      const { keeper, grafana } = await keeperWith(saved);
      grafana.runState = "running";

      await keeper.keepAtStart();

      expect(grafana.calls).toEqual(["state", "stop"]);
      expect(grafana.runState).toBe("stopped");
    });

    it("leaves a stopped one alone when it isn't wanted", async () => {
      const { keeper, grafana } = await keeperWith({ kind: "off" });
      grafana.runState = "stopped";

      await keeper.keepAtStart();

      expect(grafana.calls).toEqual(["state"]);
    });

    it("only asks for the state when it isn't wanted and none of its own exists", async () => {
      // The adapter answers that state without Docker (docker-compose-bundled-grafana.test.ts).
      const { keeper, grafana } = await keeperWith({ kind: "off" });

      await keeper.keepAtStart();

      expect(grafana.calls).toEqual(["state"]);
      expect(grafana.runState).toBe("absent");
    });

    it.each([SET_BY_ENVIRONMENT, ENVIRONMENT_OFF])(
      "neither starts nor stops it while the environment sets telemetry (%j)",
      async (inEffect) => {
        const { keeper, grafana } = await keeperWith({ kind: "bundled-grafana" }, inEffect);
        grafana.runState = "running";

        await keeper.keepAtStart();

        expect(grafana.calls).toEqual([]);
        expect(await keeper.status({ kind: "bundled-grafana" })).toMatchObject({
          state: "not-wanted",
        });
      },
    );
  });

  describe("its state on the card", () => {
    it("reads Running from Docker after a restart, not from memory", async () => {
      const { keeper, grafana } = await keeperWith({ kind: "bundled-grafana" });
      grafana.runState = "running";

      expect(await keeper.status({ kind: "bundled-grafana" })).toEqual({
        state: "running",
        address: "http://localhost:3300",
        earlierStopped: [],
      });
      expect(grafana.calls).toEqual(["state"]);
    });

    it("tells Starting while a start runs, and Couldn't start with why", async () => {
      const { keeper, grafana } = await keeperWith({ kind: "bundled-grafana" });
      grafana.holdStarts();
      grafana.failStartWith = { kind: "image-not-pulled" };

      const started = keeper.start();
      expect((await keeper.status({ kind: "bundled-grafana" })).state).toBe("starting");
      grafana.releaseStarts();
      await started;

      expect(await keeper.status({ kind: "bundled-grafana" })).toMatchObject({
        state: "failed",
        problem: "The image grafana/otel-lgtm couldn't be pulled.",
      });
    });

    it("tells Running once Docker has it healthy after a start that ran out of time", async () => {
      const { keeper, grafana } = await keeperWith({ kind: "bundled-grafana" });
      grafana.failStartWith = { kind: "not-healthy" };
      await keeper.start();
      expect((await keeper.status({ kind: "bundled-grafana" })).state).toBe("failed");

      grafana.runState = "running";

      expect((await keeper.status({ kind: "bundled-grafana" })).state).toBe("running");
    });

    it("tells it isn't running when Docker has it stopped", async () => {
      const { keeper, grafana } = await keeperWith({ kind: "bundled-grafana" });
      grafana.runState = "stopped";

      expect(await keeper.status({ kind: "bundled-grafana" })).toMatchObject({
        state: "failed",
        problem: "It isn't running.",
      });
    });

    it("tells Docker can't be reached when its state can't be read", async () => {
      const { keeper, grafana } = await keeperWith({ kind: "bundled-grafana" });
      grafana.failStateWith = { kind: "docker-unreachable" };

      expect(await keeper.status({ kind: "bundled-grafana" })).toMatchObject({
        state: "failed",
        problem: "Docker isn't installed, or The Office can't reach it.",
      });
    });

    it("shows nothing, asking nothing of Docker, unless Bundled Grafana is saved", async () => {
      const { keeper, grafana } = await keeperWith({ kind: "off" }, EXPORTING_TO_BUNDLED);

      expect(await keeper.status({ kind: "off" })).toMatchObject({ state: "not-wanted" });
      expect(grafana.calls).toEqual([]);
    });
  });

  it("runs one start at a time: a start asked for during another joins it", async () => {
    const { keeper, grafana } = await keeperWith({ kind: "bundled-grafana" });
    grafana.holdStarts();

    const first = keeper.start();
    const second = keeper.start();
    grafana.releaseStarts();
    await Promise.all([first, second]);

    expect(grafana.calls.filter((call) => call === "start")).toHaveLength(1);
  });

  it("starts again on Try again after a failure", async () => {
    const { keeper, grafana } = await keeperWith({ kind: "bundled-grafana" });
    grafana.failStartWith = { kind: "port-taken" };
    await keeper.start();
    grafana.failStartWith = undefined;

    await keeper.start();

    expect(grafana.calls.filter((call) => call === "start")).toHaveLength(2);
    expect((await keeper.status({ kind: "bundled-grafana" })).state).toBe("running");
  });

  it("stops an earlier bundled Grafana before starting its own, and names it", async () => {
    const { keeper, grafana } = await keeperWith({ kind: "bundled-grafana" });
    grafana.earlier = ["the-office-grafana"];

    await keeper.start();

    expect(grafana.calls).toEqual(["earlierContainers", "stopEarlier", "start"]);
    expect(grafana.stoppedEarlier).toEqual(["the-office-grafana"]);
    expect((await keeper.status({ kind: "bundled-grafana" })).earlierStopped).toEqual([
      "the-office-grafana",
    ]);
  });
});
