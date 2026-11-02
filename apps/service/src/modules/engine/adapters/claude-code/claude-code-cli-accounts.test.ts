import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { SignInFailed, SignInNotRunning } from "../../ports/claude-code-accounts.js";
import { ClaudeCodeCliAccounts } from "./claude-code-cli-accounts.js";
import { engineConfigFolder } from "./engine-config-folder.js";

/**
 * A stand-in for the binary's `auth` commands, as the 2.1.310 binary behaved with no TTY: `status`
 * exits 1 when signed out and still prints its status; `login` prints its page, then waits for its
 * callback or a code pasted on its input, an invalid code leaving it waiting.
 */
const FAKE_CLAUDE = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
const folder = process.env.CLAUDE_CONFIG_DIR;
const account = join(folder, "account.json");
const [, , , action] = process.argv;
if (action === "status") {
  if (existsSync(account)) {
    process.stdout.write(JSON.stringify({ loggedIn: true, ...JSON.parse(readFileSync(account, "utf8")) }));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({ loggedIn: false, authMethod: "none" }));
  process.exit(1);
}
if (existsSync(join(folder, "login-fails"))) {
  process.stderr.write("Login is turned off here.\\n");
  process.exit(1);
}
process.stdout.write("Opening browser to sign in…\\n");
process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\\nPaste code here if prompted > ");
createInterface({ input: process.stdin }).on("line", (code) => {
  if (code !== "good-code") {
    process.stderr.write("Invalid code. Please make sure the full code was copied.\\n");
    return;
  }
  writeFileSync(account, JSON.stringify({ email: "ada@example.com", subscriptionType: "max" }));
  process.stdout.write("Login successful.\\n");
  process.exit(0);
});
`;

const PAGE = "https://claude.com/cai/oauth/authorize?code=true";

let folder: string;
let officeData: OfficeDataDirectory;
let accounts: ClaudeCodeCliAccounts;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-claude-accounts-"));
  const script = join(folder, "fake-claude.mjs");
  await writeFile(script, FAKE_CLAUDE);
  officeData = new OfficeDataDirectory(join(folder, "office-data"));
  accounts = new ClaudeCodeCliAccounts(
    () => ({ command: process.execPath, args: [script] }),
    officeData,
    currentOperatingSystem().processTrees,
    {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      // The user's own folder never reaches the binary.
      CLAUDE_CONFIG_DIR: join(folder, "users-own-claude"),
    },
  );
});

afterEach(async () => {
  await accounts.onModuleDestroy();
  await rm(folder, { recursive: true, force: true });
});

describe("the Claude Code accounts through the binary", () => {
  it("reads a fresh engine as signed out, in a folder of its own", async () => {
    await expect(accounts.account("work")).resolves.toEqual({ signedIn: false });

    expect((await stat(engineConfigFolder(officeData, "work"))).isDirectory()).toBe(true);
  });

  it("signs in by a pasted code, the engine's own folder only", async () => {
    const signIn = await accounts.signIn("work");

    expect(signIn.url).toBe(PAGE);
    await accounts.enterCode("work", "  good-code ");
    await signIn.ended;
    await expect(accounts.account("work")).resolves.toEqual({
      signedIn: true,
      email: "ada@example.com",
      plan: "max",
    });
    await expect(accounts.account("home")).resolves.toEqual({ signedIn: false });
  });

  it("keeps the Sign in waiting after a wrong code", async () => {
    const signIn = await accounts.signIn("work");
    await accounts.enterCode("work", "wrong-code");
    await accounts.enterCode("work", "good-code");
    await signIn.ended;

    await expect(accounts.account("work")).resolves.toMatchObject({ signedIn: true });
  });

  it("ends a Sign in still under way when another starts on the engine", async () => {
    const first = await accounts.signIn("work");
    const second = await accounts.signIn("work");

    await first.ended;
    await accounts.enterCode("work", "good-code");
    await second.ended;
    await expect(accounts.account("work")).resolves.toMatchObject({ signedIn: true });
  });

  it("refuses a code with no Sign in under way", async () => {
    await expect(accounts.enterCode("work", "good-code")).rejects.toThrow(SignInNotRunning);
  });

  it("refuses in the binary's words a Sign in that ends before giving its page", async () => {
    await mkdir(engineConfigFolder(officeData, "work"), { recursive: true });
    await writeFile(join(engineConfigFolder(officeData, "work"), "login-fails"), "");

    await expect(accounts.signIn("work")).rejects.toThrow(
      new SignInFailed("Claude Code ended the Sign in: Login is turned off here."),
    );
  });

  it("makes an engine's folder when it is added, and removes it with its account and Sign in", async () => {
    await accounts.prepareConfigFolder("work");
    expect((await stat(engineConfigFolder(officeData, "work"))).isDirectory()).toBe(true);
    const first = await accounts.signIn("work");
    await accounts.enterCode("work", "good-code");
    await first.ended;
    const second = await accounts.signIn("work");

    await accounts.removeConfigFolder("work");

    await second.ended;
    await expect(accounts.enterCode("work", "good-code")).rejects.toThrow(SignInNotRunning);
    await expect(stat(engineConfigFolder(officeData, "work"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("ends every Sign in under way as the service stops", async () => {
    const signIn = await accounts.signIn("work");

    await accounts.onModuleDestroy();
    await signIn.ended;
    await expect(accounts.enterCode("work", "good-code")).rejects.toThrow(SignInNotRunning);
  });
});
