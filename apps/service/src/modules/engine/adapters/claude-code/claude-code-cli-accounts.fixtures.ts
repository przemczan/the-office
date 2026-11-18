import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { AnthropicApiKey } from "../../domain/anthropic-api-key.js";
import { PastedToken } from "../../domain/pasted-token.js";
import { ClaudeCodeCliAccounts } from "./claude-code-cli-accounts.js";

// What claude-code-cli-accounts.test.ts and claude-code-cli-accounts.full.test.ts share.

/**
 * A stand-in for the binary's `auth` commands, as the 2.1.310 binary behaved with no TTY: `status`
 * reads the folder signed in while it holds `.credentials.json`, exits 1 when signed out and still
 * prints its status; `login` prints its page, then waits for its callback or a code pasted on its
 * input, an invalid code leaving it waiting, and a good one writes a login with a refresh token.
 */
export const FAKE_CLAUDE = `
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

export const TOKEN = PastedToken.of("sk-ant-oat01-a-pasted-token");

export const API_KEY = AnthropicApiKey.of("sk-ant-api03-an-api-key");

export let folder: string;

export let officeData: OfficeDataDirectory;

export let accounts: ClaudeCodeCliAccounts;

/** The hooks every test of both files runs. */
export function setUpEachTest(): void {
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
}
