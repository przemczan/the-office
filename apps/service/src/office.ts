import { fileURLToPath } from "node:url";
import { Logger, type DynamicModule, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { InterruptedAnswers } from "./modules/conversations/index.js";
import { FireAlarmService, QueueService } from "./modules/work/index.js";
import { InvalidOfficeConfigError } from "./platform/config/invalid-office-config-error.js";
import { readOfficeConfig, type OfficeConfig } from "./platform/config/office-config.js";
import { configureHttp, HTTP_APPLICATION_OPTIONS } from "./platform/http/configure-http.js";
import { currentOperatingSystem } from "./platform/os/current-operating-system.js";
import { OfficeLogger } from "./platform/telemetry/office-logger.js";
import type { StartedTelemetry } from "./platform/telemetry/start-telemetry.js";
import type { WebAppSource } from "./platform/web-app/web-app.module.js";

// apps/web, from this file in src/ or dist/.
const WEB_APP_DIRECTORY = fileURLToPath(new URL("../../web/", import.meta.url));

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

const logger = new Logger("Office");

/** Makes the Nest app of the composition root; the end-to-end tests make it on a scripted engine. */
export type CreateApp = (appModule: DynamicModule) => Promise<INestApplication>;

const createApp: CreateApp = (appModule) =>
  NestFactory.create(appModule, { ...HTTP_APPLICATION_OPTIONS, abortOnError: false });

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
  { host, port }: Pick<OfficeConfig, "host" | "port">,
  prepare: (app: INestApplication) => Promise<void>,
): Promise<void> {
  configureHttp(app);
  try {
    await app.init();
    await prepare(app);
    await app.listen(port, host);
  } catch (error) {
    // Closes what started before the failure, such as the database pool, so the process can end.
    await app.close();
    throw error;
  }
  logger.log(`Serving http://${host}:${port}`);
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

/**
 * Puts right the answers the last run cut short, finishes a fire alarm's sounding it stopped
 * during (spec §2.8), which also pauses again the Tasks an all clear it stopped during had resumed
 * before turning the alarm off, then releases the kept queue (spec §2.1), since a desk may have been freed
 * while the service was down; the release holds while the alarm is on. After every module's start,
 * so the walks the release starts aren't taken for ones the last run left.
 */
async function takeUpWhereTheOfficeStopped(app: INestApplication): Promise<void> {
  await app.get(InterruptedAnswers).recover();
  await app.get(FireAlarmService).finishSounding();
  await app.get(QueueService).release();
}

async function start(
  telemetry: StartedTelemetry,
  webApp: WebAppSource,
  create: CreateApp,
): Promise<void> {
  const config = readConfig();
  const app = await create(
    AppModule.register(config, { directory: WEB_APP_DIRECTORY, source: webApp }),
  );
  await serve(app, config, takeUpWhereTheOfficeStopped);
  closeOnShutdownSignal(app, telemetry);
}

function describeStartFailure(error: unknown): string {
  if (error instanceof InvalidOfficeConfigError) return error.message;
  return `The Office cannot start. ${error instanceof Error ? error.message : String(error)}`;
}

/** Starts The Office; a failure to start is logged and ends the process with exit code 1. */
export async function runOffice(
  telemetry: StartedTelemetry,
  webApp: WebAppSource,
  create: CreateApp = createApp,
): Promise<void> {
  // Before anything logs, so a start failure is exported too; Nest and every Logger use it.
  Logger.overrideLogger(new OfficeLogger());
  try {
    await start(telemetry, webApp, create);
  } catch (error) {
    logger.fatal(describeStartFailure(error));
    process.exitCode = 1;
    await telemetry.shutdown();
  }
}
