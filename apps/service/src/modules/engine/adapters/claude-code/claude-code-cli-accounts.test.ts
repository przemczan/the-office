import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { PastedToken } from "../../domain/pasted-token.js";
import { SignInFailed, SignInNotRunning } from "../../ports/claude-code-accounts.js";
import { ClaudeCodeCliAccounts } from "./claude-code-cli-accounts.js";
import { engineConfigFolder, NotAnEngineConfigFolder } from "./engine-config-folder.js";

/**
 * A stand-in for the binary's `auth` commands, as the 2.1.310 binary behaved with no TTY: `status`
 * reads the folder signed in while it holds `.credentials.json`, exits 1 when signed out and still
 * prints its status; `login` prints its page, then waits for its callback or a code pasted on its
 * input, an invalid code leaving it waiting, and a good one writes a login with a refresh token.
 */
const FAKE_CLAUDE = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
const folder = process.env.CLAUDE_CONFIG_DIR;
const credentials = join(folder, ".credentials.json");
const account = join(folder, "account.json");
const [, , , action] = process.argv;
if (action === "status") {
  if (existsSync(credentials)) {
    const told = existsSync(account) ? JSON.parse(readFileSync(account, "utf8")) : {};
    process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", ...told }));
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
  writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-login", refreshToken: "sk-ant-ort01-login" } }));
  process.stdout.write("Login successful.\\n");
  process.exit(0);
});
`;

const PAGE = "https://claude.com/cai/oauth/authorize?code=true";
const TOKEN = PastedToken.of("sk-ant-oat01-a-pasted-token");
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

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
      pastedToken: false,
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

  it("signs in by a pasted token, written as the folder's login for its owner only", async () => {
    const before = Date.now();
    await accounts.setPastedToken("work", TOKEN);

    const file = join(engineConfigFolder(officeData, "work"), ".credentials.json");
    const { claudeAiOauth } = JSON.parse(await readFile(file, "utf8")) as {
      claudeAiOauth: {
        accessToken: string;
        refreshToken: null;
        expiresAt: number;
        scopes: string[];
      };
    };
    expect(claudeAiOauth).toMatchObject({
      accessToken: "sk-ant-oat01-a-pasted-token",
      refreshToken: null,
      scopes: ["user:inference"],
    });
    expect(claudeAiOauth.expiresAt).toBeGreaterThanOrEqual(before + YEAR_MS);
    expect(await readdir(engineConfigFolder(officeData, "work"))).toEqual([".credentials.json"]);
    await expect(accounts.account("work")).resolves.toEqual({
      signedIn: true,
      pastedToken: true,
      email: undefined,
      plan: undefined,
    });
  });

  // Windows has no file modes: the file takes the data directory's access list.
  it.skipIf(currentOperatingSystem().name === "Windows")(
    "lets only its owner read a pasted token",
    async () => {
      await accounts.setPastedToken("work", TOKEN);

      const file = join(engineConfigFolder(officeData, "work"), ".credentials.json");
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    },
  );

  it("takes a pasted token in place of a Sign in's login, ending a Sign in under way", async () => {
    const first = await accounts.signIn("work");
    await accounts.enterCode("work", "good-code");
    await first.ended;
    const second = await accounts.signIn("work");

    await accounts.setPastedToken("work", TOKEN);

    await second.ended;
    await expect(accounts.enterCode("work", "good-code")).rejects.toThrow(SignInNotRunning);
    // The earlier Sign in's email, left in the folder, is not the token's account.
    await expect(accounts.account("work")).resolves.toMatchObject({
      pastedToken: true,
      email: undefined,
    });
  });

  it("signs out, whether a Sign in or a pasted token signed in, ending a Sign in under way", async () => {
    await accounts.setPastedToken("work", TOKEN);
    await accounts.signOut("work");
    await expect(accounts.account("work")).resolves.toEqual({ signedIn: false });

    const first = await accounts.signIn("work");
    await accounts.enterCode("work", "good-code");
    await first.ended;
    const second = await accounts.signIn("work");
    await accounts.signOut("work");

    await second.ended;
    await expect(accounts.account("work")).resolves.toEqual({ signedIn: false });
    await expect(accounts.signOut("home")).resolves.toBeUndefined();
  });

  it("refuses an id leading out of the engines' folder", async () => {
    await expect(accounts.setPastedToken("../work", TOKEN)).rejects.toThrow(
      NotAnEngineConfigFolder,
    );
    await expect(accounts.signOut("..")).rejects.toThrow(NotAnEngineConfigFolder);
  });

  it("ends every Sign in under way as the service stops", async () => {
    const signIn = await accounts.signIn("work");

    await accounts.onModuleDestroy();
    await signIn.ended;
    await expect(accounts.enterCode("work", "good-code")).rejects.toThrow(SignInNotRunning);
  });
});
