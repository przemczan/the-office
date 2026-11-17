import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { CodexCliAccounts } from "./codex-cli-accounts.js";

/**
 * A stand-in for the Codex binary's commands the accounts run, as the 0.169.0 binary prints them,
 * keeping its login in `auth.json` of `CODEX_HOME`:
 * - `app-server`: answers `initialize` and `account/read` from `auth.json`;
 * - `login --device-auth`: prints its steps in terminal colours, the device page and the one-time
 *   code, then waits until `approved` lies in the folder, writing a ChatGPT login;
 * - `login --with-api-key`: reads the key on its input and writes it as the login;
 * - `logout`: removes `auth.json`, saying "Not logged in" with exit 1 when there was none.
 * Each run appends how it started (its arguments, `CODEX_HOME` and whether an OpenAI or Codex
 * variable of the user's reached it) to `runs.jsonl` beside the script.
 */
export const FAKE_CODEX = `
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
const home = process.env.CODEX_HOME;
const auth = join(home, "auth.json");
const args = process.argv.slice(2);
appendFileSync(join(dirname(process.argv[1]), "runs.jsonl"), JSON.stringify({
  args, home, cwd: process.cwd(), pid: process.pid,
  usersOwn: Object.keys(process.env).filter((name) => /^(OPENAI|CODEX)/.test(name) && name !== "CODEX_HOME"),
}) + "\\n");
const out = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
if (args[0] === "app-server") {
  createInterface({ input: process.stdin }).on("line", (line) => {
    const m = JSON.parse(line);
    if (m.method === "initialize") out({ id: m.id, result: { userAgent: "fake/0.169.0", codexHome: home } });
    if (m.method === "account/read") {
      const login = existsSync(auth) ? JSON.parse(readFileSync(auth, "utf8")) : null;
      const account = login === null ? null
        : login.OPENAI_API_KEY ? { type: "apiKey" }
        : { type: "chatgpt", email: "ada@example.com", planType: "pro" };
      out({ id: m.id, result: { account, requiresOpenaiAuth: true } });
    }
  }).on("close", () => process.exit(0));
} else if (args[0] === "login" && args[1] === "--device-auth") {
  if (existsSync(join(home, "login-fails"))) {
    process.stderr.write("Error logging in with device code: device code login is not enabled for this Codex server.\\n");
    process.exit(1);
  }
  const blue = (text) => "\\u001b[94m" + text + "\\u001b[0m";
  const dim = (text) => "\\u001b[90m" + text + "\\u001b[0m";
  process.stderr.write("\\nWelcome to Codex [v" + dim("0.169.0") + "]\\n" + dim("OpenAI's command-line coding agent") + "\\n\\n");
  process.stderr.write("Follow these steps to sign in with ChatGPT using device code authorization:\\n\\n");
  process.stderr.write("1. Open this link in your browser and sign in to your account\\n   " + blue("https://auth.openai.com/codex/device") + "\\n\\n");
  // The code comes in two writes, as a pipe may cut it.
  process.stderr.write("2. Enter this one-time code " + dim("(expires in 15 minutes)") + "\\n   \\u001b[94mFAKE");
  setTimeout(() => {
    process.stderr.write("-C0DE7\\u001b[0m\\n\\n" + dim("Continue only if you started this login in Codex.") + "\\n");
    const waiting = setInterval(() => {
      if (!existsSync(join(home, "approved"))) return;
      clearInterval(waiting);
      writeFileSync(auth, JSON.stringify({ tokens: { access_token: "chatgpt-login" } }));
      process.stderr.write("Successfully logged in\\n");
      process.exit(0);
    }, 20);
  }, 50);
} else if (args[0] === "login" && args[1] === "--with-api-key") {
  let key = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { key += chunk; });
  process.stdin.on("end", () => {
    key = key.trim();
    if (key === "") { process.stderr.write("No API key provided via stdin.\\n"); process.exit(1); }
    writeFileSync(auth, JSON.stringify({ OPENAI_API_KEY: key }));
    process.stderr.write("Successfully logged in\\n");
    process.exit(0);
  });
} else if (args[0] === "logout") {
  if (!existsSync(auth)) { process.stderr.write("Not logged in\\n"); process.exit(1); }
  rmSync(auth);
  process.stderr.write("Successfully logged out\\n");
  process.exit(0);
} else {
  process.stderr.write("unknown command\\n");
  process.exit(2);
}
`;

/** What one run of the stand-in binary reported. */
export interface FakeCodexRun {
  readonly args: readonly string[];
  readonly home: string;
  readonly cwd: string;
  readonly usersOwn: readonly string[];
}

export let folder: string;

export let officeData: OfficeDataDirectory;

export let accounts: CodexCliAccounts;

/** Every run of the stand-in binary so far, in order. */
export async function fakeCodexRuns(): Promise<FakeCodexRun[]> {
  const text = await readFile(join(folder, "runs.jsonl"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as FakeCodexRun);
}

/** Approves the device-code login under way on the engine's folder, as the user would. */
export async function approve(home: string): Promise<void> {
  await appendFile(join(home, "approved"), "");
}

/** The hooks every test of the file runs. */
export function setUpEachTest(): void {
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-codex-accounts-"));
    const script = join(folder, "fake-codex.mjs");
    await writeFile(script, FAKE_CODEX);
    officeData = new OfficeDataDirectory(join(folder, "office-data"));
    accounts = new CodexCliAccounts(
      () => ({ command: process.execPath, args: [script] }),
      officeData,
      currentOperatingSystem().processTrees,
      {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        // The user's own folder and key never reach the binary.
        CODEX_HOME: join(folder, "users-own-codex"),
        OPENAI_API_KEY: "sk-users-own-key",
      },
    );
  });

  afterEach(async () => {
    await accounts.onModuleDestroy();
    await rm(folder, { recursive: true, force: true });
  });
}
