import { startTelemetry } from "./platform/telemetry/start-telemetry.js";

// Telemetry starts before the service is imported, so its instrumentations patch the modules the
// service loads. Import nothing else here.
const telemetry = await startTelemetry();
const { runOffice } = await import("./office.js");
await runOffice(telemetry);
