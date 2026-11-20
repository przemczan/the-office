import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { SignInFailed, SignInNotRunning } from "../../ports/claude-code-accounts.js";
import { engineConfigFolder } from "../engine-folders/engine-config-folder.js";
import { TOKEN, officeData, accounts, setUpEachTest } from "./claude-code-cli-accounts.fixtures.js";

setUpEachTest();

const PAGE = "https://claude.com/cai/oauth/authorize?code=true";

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
      apiKey: false,
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
      apiKey: false,
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

  it("ends every Sign in under way as the service stops", async () => {
    const signIn = await accounts.signIn("work");

    await accounts.onModuleDestroy();
    await signIn.ended;
    await expect(accounts.enterCode("work", "good-code")).rejects.toThrow(SignInNotRunning);
  });
});
