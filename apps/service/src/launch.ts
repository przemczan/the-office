import type { CreateApp } from "./office.js";
import { startTelemetry } from "./platform/telemetry/start-telemetry.js";
import type { WebAppSource } from "./platform/web-app/web-app.module.js";

/**
 * Starts telemetry and then loads `office.ts`, so the instrumentations patch the modules the
 * service loads. Import nothing else here, but types.
 */
export async function launch(webApp: WebAppSource, create?: CreateApp): Promise<void> {
  const telemetry = await startTelemetry();
  const { runOffice } = await import("./office.js");
  await runOffice(telemetry, webApp, create);
}
