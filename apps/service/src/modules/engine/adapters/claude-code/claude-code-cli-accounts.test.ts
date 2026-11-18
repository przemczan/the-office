import { execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isOwnerOnly } from "../../../../platform/os/owner-only.fixtures.js";
import { API_KEY_ACCOUNT } from "../../domain/engine-account.js";
import { engineConfigFolder, NotAnEngineConfigFolder } from "./engine-config-folder.js";
import { apiKeyHelperOf } from "./engine-credentials.js";
import {
  API_KEY,
  TOKEN,
  officeData,
  accounts,
  setUpEachTest,
} from "./claude-code-cli-accounts.fixtures.js";

setUpEachTest();

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

describe("the Claude Code accounts through the binary", () => {
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
      apiKey: false,
      email: undefined,
      plan: undefined,
    });
  });

  it("signs in by an API key in a file of its own, for its owner only, outside projects/, in place of a pasted token", async () => {
    await accounts.setPastedToken("work", TOKEN);

    await accounts.setApiKey("work", API_KEY);

    const folder = engineConfigFolder(officeData, "work");
    expect(await readdir(folder)).toEqual([".anthropic-api-key"]);
    const file = join(folder, ".anthropic-api-key");
    expect(await readFile(file, "utf8")).toBe("sk-ant-api03-an-api-key");
    expect(await isOwnerOnly(file)).toBe(true);
    await expect(accounts.account("work")).resolves.toEqual(API_KEY_ACCOUNT);
  });

  it("gives the sessions a helper that prints the key file, naming the file, never the key", async () => {
    const folder = engineConfigFolder(officeData, "work");
    await accounts.setPastedToken("work", TOKEN);
    await expect(apiKeyHelperOf(folder, currentOperatingSystem())).resolves.toBeUndefined();

    await accounts.setApiKey("work", API_KEY);

    const helper = await apiKeyHelperOf(folder, currentOperatingSystem());
    expect(helper).toContain(".anthropic-api-key");
    expect(helper).not.toContain("sk-ant");
    // As the binary runs it: through the system's shell.
    expect(execSync(helper ?? "", { encoding: "utf8", windowsHide: true })).toBe(
      "sk-ant-api03-an-api-key",
    );
  });

  it("removes the API key once a pasted token or a Sign in takes its place, or Sign out", async () => {
    const folder = engineConfigFolder(officeData, "work");
    await accounts.setApiKey("work", API_KEY);
    await accounts.setPastedToken("work", TOKEN);
    expect(await readdir(folder)).toEqual([".credentials.json"]);

    await accounts.setApiKey("work", API_KEY);
    const signIn = await accounts.signIn("work");
    // The key stays until the Sign in signs the folder in.
    expect(await readdir(folder)).toContain(".anthropic-api-key");
    await accounts.enterCode("work", "good-code");
    await signIn.ended;
    expect((await readdir(folder)).toSorted()).toEqual([".credentials.json", "account.json"]);
    await expect(accounts.account("work")).resolves.toMatchObject({ apiKey: false, plan: "max" });

    await accounts.setApiKey("work", API_KEY);
    await accounts.signOut("work");
    expect(await readdir(folder)).toEqual(["account.json"]);
    await expect(accounts.account("work")).resolves.toEqual({ signedIn: false });
  });

  it("keeps the API key when a Sign in under way is ended by it", async () => {
    const signIn = await accounts.signIn("work");

    await accounts.setApiKey("work", API_KEY);
    await signIn.ended;

    await expect(accounts.account("work")).resolves.toEqual(API_KEY_ACCOUNT);
  });

  it("refuses an id leading out of the engines' folder", async () => {
    await expect(accounts.setPastedToken("../work", TOKEN)).rejects.toThrow(
      NotAnEngineConfigFolder,
    );
    await expect(accounts.signOut("..")).rejects.toThrow(NotAnEngineConfigFolder);
  });
});
