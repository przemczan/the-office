import { fileURLToPath } from "node:url";
import { Logger, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { InterruptedAnswers } from "./modules/conversations/index.js";
import { InvalidOfficeConfigError } from "./platform/config/invalid-office-config-error.js";
import { readOfficeConfig, type OfficeConfig } from "./platform/config/office-config.js";
import { configureHttp } from "./platform/http/configure-http.js";
import { currentOperatingSystem } from "./platform/os/current-operating-system.js";
import { OfficeLogger } from "./platform/telemetry/office-logger.js";
import type { StartedTelemetry } from "./platform/telemetry/start-telemetry.js";
import type { WebAppSource } from "./platform/web-app/web-app.module.js";

// Tier 1 serves this machine alone (spec §5.1).
const LOCALHOST = "127.0.0.1";

// apps/web, from this file in src/ or dist/.
const WEB_APP_DIRECTORY = fileURLToPath(new URL("../../web/", import.meta.url));

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

const logger = new Logger("Office");

function readConfig(): OfficeConfig {
  return readOfficeConfig(process.env, {
    officeDataDirectory: () => currentOperatingSystem().defaultOfficeDataDirectory,
  });
}

/**
 * Serves once `prepare` has run on the started app: work the last run left half-done is put right
 * before any request can reach it.
 */
async function serve(
  app: INestApplication,
  port: number,
  prepare: (app: INestApplication) => Promise<void>,
): Promise<void> {
  configureHttp(app);
  try {
    await app.init();
    await prepare(app);
    await app.listen(port, LOCALHOST);
  } catch (error) {
    // Closes what started before the failure, such as the database pool, so the process can end.
    await app.close();
    throw error;
  }
  logger.log(`Serving http://localhost:${port}`);
}

/**
 * Closes the service, then telemetry, on the first shutdown signal. Nest's own shutdown hooks
 * would end the process before telemetry exported the last spans and logs.
 */
function closeOnShutdownSignal(app: INestApplication, telemetry: StartedTelemetry): void {
  const close = (signal: NodeJS.Signals): void => {
    // A second signal during the shutdown ends the process at once.
    for (const each of SHUTDOWN_SIGNALS) process.removeListener(each, close);
    void app
      .close()
      .finally(() => telemetry.shutdown())
      // With no listener left, the signal ends the process as it would have unhandled.
      .finally(() => process.kill(process.pid, signal));
  };
  for (const signal of SHUTDOWN_SIGNALS) process.on(signal, close);
}

async function start(telemetry: StartedTelemetry, webApp: WebAppSource): Promise<void> {
  const config = readConfig();
  const app = await NestFactory.create(
    AppModule.register(config, { directory: WEB_APP_DIRECTORY, source: webApp }),
    { abortOnError: false },
  );
  await serve(app, config.port, (started) => started.get(InterruptedAnswers).recover());
  closeOnShutdownSignal(app, telemetry);
}

function describeStartFailure(error: unknown): string {
  if (error instanceof InvalidOfficeConfigError) return error.message;
  return `The Office cannot start. ${error instanceof Error ? error.message : String(error)}`;
}

/** Starts The Office; a failure to start is logged and ends the process with exit code 1. */
export async function runOffice(telemetry: StartedTelemetry, webApp: WebAppSource): Promise<void> {
  // Before anything logs, so a start failure is exported too; Nest and every Logger use it.
  Logger.overrideLogger(new OfficeLogger());
  try {
    await start(telemetry, webApp);
  } catch (error) {
    logger.fatal(describeStartFailure(error));
    process.exitCode = 1;
    await telemetry.shutdown();
  }
}
