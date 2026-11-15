import { stderr, stdout } from "node:process";
import { NestFactory } from "@nestjs/core";
import { HostCommandModule } from "./host-command.module.js";
import { FirstRunSetup } from "./modules/users/index.js";
import { addressToOpen } from "./platform/config/address-to-open.js";
import {
  readDatabaseUrl,
  readOfficeConfig,
  type EnvironmentVariables,
} from "./platform/config/office-config.js";
import { currentOperatingSystem } from "./platform/os/current-operating-system.js";
import { setupTokenCommand, type SetupTokenConsole } from "./setup-token-command.js";

const terminal: SetupTokenConsole = {
  info: (line) => stdout.write(`${line}\n`),
  error: (line) => stderr.write(`${line}\n`),
};

/** Where to open The Office, when the environment says how the service listens. */
function addressFrom(environment: EnvironmentVariables): string | undefined {
  try {
    return addressToOpen(
      readOfficeConfig(environment, {
        officeDataDirectory: () => currentOperatingSystem().defaultOfficeDataDirectory,
      }),
    );
  } catch {
    // The token needs the database alone; the address is only a help.
    return undefined;
  }
}

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(
    HostCommandModule.register(readDatabaseUrl(process.env)),
    { logger: ["error"] },
  );
  try {
    return await setupTokenCommand(process.argv.slice(2), terminal, {
      firstRunSetup: app.get(FirstRunSetup),
      addressToOpen: addressFrom(process.env),
    });
  } finally {
    await app.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
