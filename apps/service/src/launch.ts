import type { CreateApp } from "./office.js";
import { currentOperatingSystem } from "./platform/os/current-operating-system.js";
import { startTelemetry } from "./platform/telemetry/start-telemetry.js";
import { readTelemetryFile, telemetryFilePath } from "./platform/telemetry/telemetry-file.js";
import {
  telemetrySettingsFrom,
  type TelemetryInEffect,
} from "./platform/telemetry/telemetry-settings.js";
import type { WebAppSource } from "./platform/web-app/web-app.module.js";

/**
 * The telemetry this start applies: the environment's OTEL_* variables, else the setting saved in
 * the Office data directory. A setting that can't be read leaves telemetry off, never the start
 * failed; its problem is told without its contents, which can hold credentials.
 */
async function telemetryInEffect(): Promise<TelemetryInEffect> {
  const officeDataDirectory =
    process.env["OFFICE_DATA_DIR"]?.trim() || currentOperatingSystem().defaultOfficeDataDirectory;
  const reading = await readTelemetryFile(telemetryFilePath(officeDataDirectory));
  if ("problem" in reading && reading.problem) {
    process.stderr.write(`Telemetry is off: ${reading.problem}.\n`);
  }
  return telemetrySettingsFrom(reading.choice, process.env);
}

/**
 * Starts telemetry and then loads `office.ts`, so the instrumentations patch the modules the
 * service loads. Import nothing else here, but types and what reads the telemetry setting, none of
 * which loads Nest, Express or pg.
 */
export async function launch(
  webApp: WebAppSource,
  create?: CreateApp,
  officeCheckout?: string,
): Promise<void> {
  const telemetry = await startTelemetry(await telemetryInEffect());
  const { runOffice } = await import("./office.js");
  await runOffice(telemetry, webApp, create, officeCheckout);
}
