import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { engineConfigFolder, NotAnEngineConfigFolder } from "./engine-config-folder.js";
import { TOKEN, officeData, accounts, setUpEachTest } from "./claude-code-cli-accounts.fixtures.js";

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
      email: undefined,
      plan: undefined,
    });
  });

  it("refuses an id leading out of the engines' folder", async () => {
    await expect(accounts.setPastedToken("../work", TOKEN)).rejects.toThrow(
      NotAnEngineConfigFolder,
    );
    await expect(accounts.signOut("..")).rejects.toThrow(NotAnEngineConfigFolder);
  });
});
