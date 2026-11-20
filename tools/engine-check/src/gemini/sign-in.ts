import { spawn } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import {
  geminiFolder,
  isSignedIn,
  SIGN_IN_RECORD,
  SIGNED_IN_HOME,
  writeHome,
  type SignInRecord,
} from "./gemini-home.ts";
import { pinnedCliEntry } from "./pinned-cli.ts";
import { geminiProcessEnvironment } from "./session-environment.ts";

const CODE_PROMPT = "Enter the authorization code";
/** The CLI waits 5 minutes for a code, twice; this covers both and the start. */
const SIGN_IN_TIMEOUT_MS = 12 * 60 * 1000;
const TERMINAL_CONTROL = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?<>=]*[A-Za-z]`, "g");
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: 1, clientCapabilities: {} },
};

/**
 * Signs a Google account into the check's own folder (`SIGNED_IN_HOME`) the way Settings › Engines
 * would, with no terminal: the pinned CLI starts in ACP mode with `NO_BROWSER`, its stdin a pipe. It
 * prints the sign-in address; the code the user pastes here is written to its stdin. Once the CLI
 * answers ACP's `initialize`, it is signed in. A folder already signed in answers at once.
 */
export async function signInToGemini(): Promise<number> {
  await writeHome(SIGNED_IN_HOME, {
    settings: {
      security: { auth: { selectedType: "oauth-personal" } },
      privacy: { usageStatisticsEnabled: false },
      general: { enableAutoUpdate: false, enableAutoUpdateNotification: false },
    },
  });
  const child = spawn(process.execPath, [pinnedCliEntry(), "--acp"], {
    cwd: SIGNED_IN_HOME,
    env: geminiProcessEnvironment(SIGNED_IN_HOME),
    stdio: ["pipe", "pipe", "inherit"],
  });
  const user = createInterface({ input: process.stdin, output: process.stdout });
  let awaitingCode = false;
  const answered = new Promise<boolean>((resolve) => {
    let buffered = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffered += chunk;
      if (buffered.includes(CODE_PROMPT)) {
        process.stdout.write(withoutTerminalControls(buffered));
        buffered = "";
        awaitingCode = true;
        user.question("", (code) => {
          child.stdin.write(`${code.trim()}\n`);
          awaitingCode = false;
        });
        return;
      }
      for (const line of buffered.split("\n").slice(0, -1)) {
        if (line.includes('"id":1') && line.includes('"result"')) {
          resolve(true);
        } else {
          process.stdout.write(`${withoutTerminalControls(line)}\n`);
        }
      }
      buffered = buffered.slice(buffered.lastIndexOf("\n") + 1);
    });
    child.once("exit", () => resolve(false));
    user.once("close", () => resolve(false));
    setTimeout(() => resolve(false), SIGN_IN_TIMEOUT_MS).unref();
  });
  // The CLI reads the code from the same stdin ACP later reads, so `initialize` waits for the sign-in.
  const initializeOnceSignedIn = setInterval(async () => {
    if ((await isSignedIn(SIGNED_IN_HOME)) && !awaitingCode && child.stdin.writable) {
      clearInterval(initializeOnceSignedIn);
      child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
    }
  }, 1000);
  const initialized = await answered;
  clearInterval(initializeOnceSignedIn);
  user.close();
  child.kill();
  const signedIn = initialized && (await isSignedIn(SIGNED_IN_HOME));
  const record: SignInRecord = {
    stdinWasTerminal: false,
    signedIn,
    filesLeft: (await readdir(geminiFolder(SIGNED_IN_HOME))).toSorted(),
  };
  await writeFile(SIGN_IN_RECORD, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(
    signedIn
      ? `\nSigned in. The credentials are in ${geminiFolder(SIGNED_IN_HOME)}.\n`
      : `\nNot signed in.\n`,
  );
  return signedIn ? 0 : 1;
}

/** The CLI draws its code prompt on a terminal's alternate screen; relayed as plain lines, it stays in view. */
function withoutTerminalControls(text: string): string {
  return text.replace(TERMINAL_CONTROL, "");
}
