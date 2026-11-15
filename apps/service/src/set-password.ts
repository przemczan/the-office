import { stdin, stdout, stderr } from "node:process";
import { NestFactory } from "@nestjs/core";
import { HostCommandModule } from "./host-command.module.js";
import { Authenticators, Passwords } from "./modules/users/index.js";
import { readDatabaseUrl } from "./platform/config/office-config.js";
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

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(
    HostCommandModule.register(readDatabaseUrl(process.env)),
    {
      logger: ["error"],
    },
  );
  try {
    return await setPasswordCommand(process.argv.slice(2), terminal, {
      passwords: app.get(Passwords),
      authenticators: app.get(Authenticators),
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
