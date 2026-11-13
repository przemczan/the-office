import { fileURLToPath } from "node:url";
import { Logger, type DynamicModule, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { InterruptedAnswers, SubAgentsAndProcesses } from "./modules/conversations/index.js";
import { OfficeUpdates } from "./modules/office-updates/index.js";
import { RunEnvironments } from "./modules/run-environments/index.js";
import {
  DroppedInitiativeTasks,
  FireAlarmService,
  InitiativeArchiving,
  QueueService,
  TaskArchiving,
  UsageWindowResumes,
} from "./modules/work/index.js";
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

/** What the service exits with to have its launcher update it (tools/office-launcher). */
const UPDATE_EXIT_CODE = 75;

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
 * Closes the service, then telemetry, once a scheduled Office update finds nothing busy, and exits
 * with the code that has the launcher install the update and start the service again.
 */
function closeForUpdate(app: INestApplication, telemetry: StartedTelemetry): void {
  app.get(OfficeUpdates).onReadyToUpdate(() => {
    void app
      .close()
      .finally(() => telemetry.shutdown())
      .finally(() => process.exit(UPDATE_EXIT_CODE));
  });
}

/**
 * Puts right the answers the last run cut short, finishes a fire alarm's sounding it stopped
 * during (spec §2.8), which also pauses again the Tasks an all clear it stopped during had resumed
 * before turning the alarm off, drops the Tasks that Initiatives dropped earlier left open (spec
 * §2.1), so none of them starts, sets again the resume of each Task the usage window paused,
 * resuming one whose reset passed meanwhile (spec §2.1), then releases the kept queue (spec §2.1),
 * since a desk may have been freed while the service was down; the release holds while the alarm is on. Last, it starts the
 * daily archiving of finished Tasks and ended Initiatives, here only so a test app never runs it, and sweeps the run
 * environments the last run left (spec §5.5) in the background, as the container runtime may be
 * slow or not there. After every module's start, so the walks the release starts aren't taken for
 * ones the last run left.
 */
async function takeUpWhereTheOfficeStopped(app: INestApplication): Promise<void> {
  await app.get(InterruptedAnswers).recover();
  await app.get(SubAgentsAndProcesses).recover();
  await app.get(FireAlarmService).finishSounding();
  await app.get(DroppedInitiativeTasks).dropLeftOpen();
  await app.get(UsageWindowResumes).start();
  await app.get(QueueService).release();
  app.get(TaskArchiving).start();
  app.get(InitiativeArchiving).start();
  void app
    .get(RunEnvironments)
    .sweep()
    .catch((error: unknown) => {
      logger.warn(`The run environments the last run left were not swept: ${String(error)}`);
    });
}

async function start(
  telemetry: StartedTelemetry,
  webApp: WebAppSource,
  create: CreateApp,
  officeCheckout: string | undefined,
): Promise<void> {
  const config = readConfig();
  const app = await create(
    AppModule.register(config, { directory: WEB_APP_DIRECTORY, source: webApp }, officeCheckout),
  );
  await serve(app, config, takeUpWhereTheOfficeStopped);
  closeOnShutdownSignal(app, telemetry);
  closeForUpdate(app, telemetry);
}

function describeStartFailure(error: unknown): string {
  if (error instanceof InvalidOfficeConfigError) return error.message;
  return `The Office cannot start. ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Starts The Office; a failure to start is logged and ends the process with exit code 1.
 * `officeCheckout` stands in for The Office's own checkout, as in the end-to-end tests.
 */
export async function runOffice(
  telemetry: StartedTelemetry,
  webApp: WebAppSource,
  create: CreateApp = createApp,
  officeCheckout?: string,
): Promise<void> {
  // Before anything logs, so a start failure is exported too; Nest and every Logger use it.
  Logger.overrideLogger(new OfficeLogger());
  try {
    await start(telemetry, webApp, create, officeCheckout);
  } catch (error) {
    logger.fatal(describeStartFailure(error));
    process.exitCode = 1;
    await telemetry.shutdown();
  }
}
