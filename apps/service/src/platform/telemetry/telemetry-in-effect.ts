import { TELEMETRY_OFF, type TelemetryInEffect } from "./telemetry-settings.js";

// Set once by startTelemetry, before any Nest module loads; a test app, which starts none, is off.
let startedWith: TelemetryInEffect = TELEMETRY_OFF;

/** Keeps what telemetry this process started with, for Settings › Telemetry to tell. */
export function rememberTelemetryInEffect(inEffect: TelemetryInEffect): void {
  startedWith = inEffect;
}

/** What telemetry this run of The Office has, as its start decided it. */
export class RunningTelemetrySettings {
  constructor(readonly inEffect: TelemetryInEffect) {}

  static ofThisProcess(): RunningTelemetrySettings {
    return new RunningTelemetrySettings(startedWith);
  }
}
