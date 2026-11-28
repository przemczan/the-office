import { fileURLToPath } from "node:url";
import { Logger, type DynamicModule, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ActionRuns } from "./modules/actions/index.js";
import { InterruptedAnswers, SubAgentsAndProcesses } from "./modules/conversations/index.js";
import { ScheduledExits } from "./modules/office-updates/index.js";
import { FirstRunSetup } from "./modules/users/index.js";
import { ConnectedDevices, ProjectDevices } from "./modules/devices/index.js";
import { DeviceHelperFiles, RunEnvironments } from "./modules/run-environments/index.js";
import {
  TestBuildRetention,
  TestInstanceProxy,
  TestInstances,
} from "./modules/test-instances/index.js";
import {
  BranchCleanup,
  DroppedInitiativeTasks,
  DroppedTaskDecisions,
  FireAlarmService,
  InitiativeArchiving,
  PlanningAfterRestart,
  QueueService,
  TaskArchiving,
  UsageWindowResumes,
} from "./modules/work/index.js";
import { addressToOpen } from "./platform/config/address-to-open.js";
import { InvalidOfficeConfigError } from "./platform/config/invalid-office-config-error.js";
import { readOfficeConfig, type OfficeConfig } from "./platform/config/office-config.js";
import { configureHttp, HTTP_APPLICATION_OPTIONS } from "./platform/http/configure-http.js";
import { currentOperatingSystem } from "./platform/os/current-operating-system.js";
import { BundledGrafanaKeeper } from "./platform/telemetry/bundled-grafana/bundled-grafana-keeper.js";
import { OfficeLogger } from "./platform/telemetry/office-logger.js";
import type { StartedTelemetry } from "./platform/telemetry/start-telemetry.js";
import type { WebAppSource } from "./platform/web-app/web-app.module.js";

// apps/web, from this file in src/ or dist/.
const WEB_APP_DIRECTORY = fileURLToPath(new URL("../../web/", import.meta.url));

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * What the service exits with to have its launcher update or restart it (tools/office-launcher);
 * not zero, so a container's `on-failure` restart policy starts it again too.
 */
const SCHEDULED_EXIT_CODE = 75;

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
    // With no listener left, the signal ends the process as it would have unhandled.
    closeThen(app, telemetry, () => process.kill(process.pid, signal));
  };
  for (const signal of SHUTDOWN_SIGNALS) process.on(signal, close);
}

/**
 * Closes the service, then telemetry, once a scheduled Office update or restart finds nothing busy,
 * and exits with the code that has the launcher install the update, if any, and start the service
 * again; Docker's restart policy starts a container again.
 */
function closeForScheduledExit(app: INestApplication, telemetry: StartedTelemetry): void {
  app.get(ScheduledExits).onReadyToExit(() => {
    closeThen(app, telemetry, () => process.exit(SCHEDULED_EXIT_CODE));
  });
}

/** Closes the service, then telemetry, then ends the process with `end`, however they closed. */
function closeThen(app: INestApplication, telemetry: StartedTelemetry, end: () => void): void {
  void app
    .close()
    .catch((error: unknown) => {
      logger.error(`The Office didn't close cleanly: ${String(error)}`);
    })
    .then(() => telemetry.shutdown())
    .then(end, end);
}

/**
 * Logs a rejected promise that nothing handled, with telemetry as every Logger record, and keeps
 * the service running: Node would otherwise end it, and with it every Agent at work.
 */
function logUnhandledRejections(): void {
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error(
      "A rejected promise was not handled.",
      reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    );
  });
}

/**
 * Puts right the answers and the background Sub-agents the last run cut short, finishes a fire
 * alarm's sounding it stopped during (spec §2.8), which also pauses again the Tasks an all clear it
 * stopped during had resumed before turning the alarm off, drops the Tasks that Initiatives dropped
 * earlier left open (spec §2.1), so none of them starts, closes the Decisions left open on dropped
 * Tasks (spec §2.4), wakes the planner in each planning Thread
 * the restart cut short (spec §2.4), sets again the resume of each Task the usage window paused,
 * resuming one whose reset passed meanwhile (spec §2.1), then releases the kept queue (spec §2.1),
 * since a desk may have been freed while the service was down; the release holds while the alarm is on. Last, it starts the
 * daily archiving of finished Tasks and ended Initiatives and the test-instance proxy's listeners, here only so a test app never runs them, sweeps the Connected devices and the pairings of Project devices (spec §2.13), the run
 * environments and the test instances the last run left (spec §5.5, §2.12), copies the Office device helper into the Office data directory (spec §5.5) and starts or stops the bundled Grafana as the
 * telemetry setting wants it, both in the background, as the container runtime may be slow or not
 * there. After every module's start, so the walks the release starts aren't taken for
 * ones the last run left.
 */
async function takeUpWhereTheOfficeStopped(app: INestApplication): Promise<void> {
  const answersCutShort = await app.get(InterruptedAnswers).recover();
  const subAgentsLost = await app.get(SubAgentsAndProcesses).recover();
  await app.get(FireAlarmService).finishSounding();
  await app.get(DroppedInitiativeTasks).dropLeftOpen();
  await app.get(DroppedTaskDecisions).closeLeftOpen();
  await app.get(PlanningAfterRestart).wake([...answersCutShort, ...subAgentsLost]);
  await app.get(UsageWindowResumes).start();
  await app.get(QueueService).release();
  app.get(TaskArchiving).start();
  app.get(InitiativeArchiving).start();
  app.get(BranchCleanup).start();
  app.get(TestBuildRetention).start();
  // A restart dropped every relay socket, so every open Connected device ends as tab closed.
  void app
    .get(ConnectedDevices)
    .sweep()
    .catch((error: unknown) => {
      logger.warn(`The Connected devices the last run left were not swept: ${String(error)}`);
    });
  // A restart cut off every pairing: its environment goes, and its Project device is Not paired.
  void app
    .get(ProjectDevices)
    .sweep()
    .catch((error: unknown) => {
      logger.warn(`The pairings the last run left were not swept: ${String(error)}`);
    });
  void app
    .get(RunEnvironments)
    .sweep()
    .catch((error: unknown) => {
      logger.warn(`The run environments the last run left were not swept: ${String(error)}`);
    });
  void app
    .get(DeviceHelperFiles)
    .copy()
    .catch((error: unknown) => {
      logger.warn(`The Office device helper wasn't copied: ${String(error)}`);
    });
  void app
    .get(TestInstanceProxy)
    .start()
    .catch((error: unknown) => {
      logger.warn(`The test-instance proxy didn't start: ${String(error)}`);
    });
  void app
    .get(TestInstances)
    .sweep()
    .catch((error: unknown) => {
      logger.warn(`The test instances the last run left were not swept: ${String(error)}`);
    });
  // A restart ended every Project command run; Workflow and Test target runs are picked up again.
  void app
    .get(ActionRuns)
    .sweep()
    .catch((error: unknown) => {
      logger.warn(`The Action runs the last run left were not swept: ${String(error)}`);
    });
  void app
    .get(BundledGrafanaKeeper)
    .keepAtStart()
    .catch((error: unknown) => {
      logger.warn(`The bundled Grafana was not checked: ${String(error)}`);
    });
}

/**
 * While The Office waits for its first user and no setup token waits, makes one and prints it with
 * where to open The Office, straight to standard output, so journald and `docker logs` show it but
 * no Logger record, exported by telemetry, ever holds it. A token made earlier, by the installer or
 * an earlier start, is kept: the start then only says how to print a new one.
 */
async function announceSetupToken(app: INestApplication, config: OfficeConfig): Promise<void> {
  const atStart = await app.get(FirstRunSetup).tokenAtStart();
  if (atStart.kind === "made") {
    process.stdout.write(
      `\nThe Office waits for its first user. Open ${addressToOpen(config)} and give it this setup token:\n\n    ${atStart.token}\n\nRun \`npm run setup-token\` on this computer for a new one.\n\n`,
    );
  } else if (atStart.kind === "waiting") {
    process.stdout.write(
      "The Office waits for its first user, with the setup token printed earlier. Run `npm run setup-token` on this computer for a new one.\n",
    );
  }
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
  await announceSetupToken(app, config);
  closeOnShutdownSignal(app, telemetry);
  closeForScheduledExit(app, telemetry);
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
  logUnhandledRejections();
  try {
    await start(telemetry, webApp, create, officeCheckout);
  } catch (error) {
    logger.fatal(describeStartFailure(error));
    process.exitCode = 1;
    await telemetry.shutdown();
  }
}
