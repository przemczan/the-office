import { Injectable } from "@nestjs/common";
import type { TelemetryChoice, TelemetrySettings } from "@the-office/contracts";
import { BundledGrafanaKeeper } from "./bundled-grafana/bundled-grafana-keeper.js";
import { savedChoiceOf } from "./telemetry-choice.js";
import { RunningTelemetrySettings } from "./telemetry-in-effect.js";
import {
  isSetByEnvironment,
  runningTelemetryOf,
  sameTelemetry,
  telemetrySettingsFrom,
} from "./telemetry-settings.js";

/** Settings › Telemetry as the web reads it: the saved choice beside what runs and the bundled Grafana. */
@Injectable()
export class TelemetrySettingsView {
  constructor(
    private readonly running: RunningTelemetrySettings,
    private readonly bundledGrafana: BundledGrafanaKeeper,
  ) {}

  async of(saved: TelemetryChoice | undefined): Promise<TelemetrySettings> {
    const inEffect = this.running.inEffect;
    const setByEnvironment = isSetByEnvironment(inEffect);
    return {
      saved: savedChoiceOf(saved),
      running: runningTelemetryOf(inEffect),
      setByEnvironment,
      appliesAtNextStart:
        !setByEnvironment && !sameTelemetry(telemetrySettingsFrom(saved, {}), inEffect),
      bundledGrafana: await this.bundledGrafana.status(saved),
    };
  }
}
