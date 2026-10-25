import { homedir } from "node:os";
import { Logger, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { InvalidOfficeConfigError } from "./platform/config/invalid-office-config-error.js";
import { readOfficeConfig, type OfficeConfig } from "./platform/config/office-config.js";
import { configureHttp } from "./platform/http/configure-http.js";
import { defaultOfficeDataDirectory } from "./platform/os/office-data-directory.js";
import { currentOperatingSystem } from "./platform/os/operating-system.js";

// Tier 1 serves this machine alone (spec §5.1).
const LOCALHOST = "127.0.0.1";

const logger = new Logger("Office");

function readConfig(): OfficeConfig {
  return readOfficeConfig(process.env, {
    officeDataDirectory: () =>
      defaultOfficeDataDirectory(currentOperatingSystem(), {
        environment: process.env,
        homeDirectory: homedir(),
      }),
  });
}

async function serve(app: INestApplication, port: number): Promise<void> {
  configureHttp(app);
  app.enableShutdownHooks();
  try {
    await app.listen(port, LOCALHOST);
  } catch (error) {
    // Closes what started before the failure, such as the database pool, so the process can end.
    await app.close();
    throw error;
  }
  logger.log(`Serving http://localhost:${port}`);
}

async function start(): Promise<void> {
  const config = readConfig();
  const app = await NestFactory.create(AppModule.register(config), { abortOnError: false });
  await serve(app, config.port);
}

function describeStartFailure(error: unknown): string {
  if (error instanceof InvalidOfficeConfigError) return error.message;
  return `The Office cannot start. ${error instanceof Error ? error.message : String(error)}`;
}

try {
  await start();
} catch (error) {
  logger.fatal(describeStartFailure(error));
  process.exitCode = 1;
}
