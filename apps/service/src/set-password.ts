import { stdin, stdout, stderr } from "node:process";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CookieSignedInRequests, Passwords, UsersModule } from "./modules/users/index.js";
import { readDatabaseUrl } from "./platform/config/office-config.js";
import { DatabaseModule } from "./platform/database/database.module.js";
import { EventsModule } from "./platform/events/events.module.js";
import { RequestAccessModule } from "./platform/http/request-access.module.js";
import { WebEventForwarding } from "./platform/websocket/web-event-forwarding.js";
import { setPasswordCommand, type SetPasswordConsole } from "./set-password-command.js";

const CONTROL_C = "\u0003";
const BACKSPACES = new Set(["\u007f", "\b"]);
const LINE_ENDS = new Set(["\r", "\n", "\u0004"]);

/** Reads a line at the terminal one key at a time, showing nothing of it. */
function askHidden(question: string): Promise<string> {
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let typed = "";
  return new Promise((resolve, reject) => {
    const onData = (keys: string): void => {
      for (const key of keys) {
        if (key === CONTROL_C) {
          finish();
          reject(new Error("Stopped; nothing was changed."));
          return;
        }
        if (LINE_ENDS.has(key)) {
          finish();
          resolve(typed);
          return;
        }
        typed = BACKSPACES.has(key) ? [...typed].slice(0, -1).join("") : typed + key;
      }
    };
    const finish = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    stdin.on("data", onData);
  });
}

async function readPiped(): Promise<string> {
  let text = "";
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) text += String(chunk);
  return text.split(/\r?\n/)[0] ?? "";
}

const terminal: SetPasswordConsole = {
  interactive: stdin.isTTY,
  askHidden,
  readPiped,
  info: (line) => stdout.write(`${line}\n`),
  error: (line) => stderr.write(`${line}\n`),
};

/** The database, events and the users module, with no HTTP: what setting a password needs. */
@Module({})
class SetPasswordModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: SetPasswordModule,
      // The users module maps its web events here; with no WebSocket, they go nowhere.
      global: true,
      providers: [WebEventForwarding],
      exports: [WebEventForwarding],
      imports: [
        DatabaseModule.forRoot({ url: databaseUrl }),
        EventsModule,
        UsersModule,
        // The users module's controllers ask for the addresses, though no request reaches them here.
        RequestAccessModule.register({
          publicAddress: undefined,
          imports: [UsersModule],
          signedInRequests: CookieSignedInRequests,
        }),
      ],
    };
  }
}

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(
    SetPasswordModule.register(readDatabaseUrl(process.env)),
    {
      logger: ["error"],
    },
  );
  try {
    return await setPasswordCommand(process.argv.slice(2), terminal, app.get(Passwords));
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
