import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CodexApiKey } from "../../domain/codex-api-key.js";
import { SignInFailed } from "../../ports/claude-code-accounts.js";
import { engineConfigFolder } from "../engine-folders/engine-config-folder.js";
import {
  accounts,
  approve,
  fakeCodexRuns,
  officeData,
  setUpEachTest,
} from "./codex-cli-accounts.fixtures.js";
import { pageAndCode } from "./codex-cli-accounts.js";

setUpEachTest();

const KEY = CodexApiKey.of("sk-proj-an-openai-key_456");

const PAGE = "https://auth.openai.com/codex/device";

function home(engineId: string): string {
  return engineConfigFolder(officeData, engineId);
}

describe("the Codex accounts through the binary", () => {
  it("reads a fresh engine as signed out through the app-server, in a folder of its own", async () => {
    await expect(accounts.account("work")).resolves.toEqual({ signedIn: false });

    expect((await stat(home("work"))).isDirectory()).toBe(true);
    const [run] = await fakeCodexRuns();
    expect(run).toMatchObject({ home: home("work"), cwd: home("work"), usersOwn: [] });
    expect(run?.args[0]).toBe("app-server");
  });

  it("signs in with ChatGPT by the device page and its one-time code, the engine's own folder only", async () => {
    const signIn = await accounts.signIn("work");

    expect({ url: signIn.url, userCode: signIn.userCode }).toEqual({
      url: PAGE,
      userCode: "FAKE-C0DE7",
    });
    await approve(home("work"));
    await signIn.ended;
    await expect(accounts.account("work")).resolves.toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: false,
      email: "ada@example.com",
      plan: "pro",
    });
    await expect(accounts.account("home")).resolves.toEqual({ signedIn: false });
    const login = (await fakeCodexRuns()).find(({ args }) => args[0] === "login");
    expect(login).toMatchObject({ args: ["login", "--device-auth"], home: home("work") });
    expect(login?.usersOwn).toEqual([]);
  });

  it("runs one Sign in per engine, ending the one under way when another starts", async () => {
    const first = await accounts.signIn("work");
    const elsewhere = await accounts.signIn("home");
    const second = await accounts.signIn("work");

    await first.ended;
    await approve(home("work"));
    await second.ended;
    await expect(accounts.account("work")).resolves.toMatchObject({ signedIn: true });
    await expect(accounts.account("home")).resolves.toEqual({ signedIn: false });
    await accounts.removeHome("home");
    await elsewhere.ended;
  });

  it("refuses in the binary's words a Sign in that ends before giving its page and code", async () => {
    await mkdir(home("work"), { recursive: true });
    await writeFile(join(home("work"), "login-fails"), "");

    await expect(accounts.signIn("work")).rejects.toThrow(
      new SignInFailed(
        "Codex ended the Sign in: Error logging in with device code: device code login is not enabled for this Codex server.",
      ),
    );
  });

  it("signs in by an API key given on the binary's input alone, ending a Sign in under way", async () => {
    const signIn = await accounts.signIn("work");

    await accounts.setApiKey("work", KEY);

    await signIn.ended;
    await expect(accounts.account("work")).resolves.toMatchObject({
      signedIn: true,
      apiKey: true,
      email: undefined,
    });
    expect(JSON.parse(await readFile(join(home("work"), "auth.json"), "utf8"))).toEqual({
      OPENAI_API_KEY: KEY.reveal(),
    });
    const keyLogin = (await fakeCodexRuns()).find(({ args }) => args.includes("--with-api-key"));
    expect(keyLogin).toMatchObject({ args: ["login", "--with-api-key"], usersOwn: [] });
    expect(JSON.stringify(await fakeCodexRuns())).not.toContain(KEY.reveal());
  });

  it("signs out, whatever signed in, ending a Sign in under way, and signed out already", async () => {
    await accounts.setApiKey("work", KEY);
    await accounts.signOut("work");
    await expect(accounts.account("work")).resolves.toEqual({ signedIn: false });

    const signIn = await accounts.signIn("work");
    await accounts.signOut("work");

    await signIn.ended;
    await expect(accounts.account("work")).resolves.toEqual({ signedIn: false });
    await expect(accounts.signOut("home")).resolves.toBeUndefined();
  });

  it("makes an engine's folder, and removes it with its account and Sign in", async () => {
    await accounts.prepareHome("work");
    expect((await stat(home("work"))).isDirectory()).toBe(true);
    expect(await accounts.engineIdsWithHomes()).toEqual(["work"]);
    const signIn = await accounts.signIn("work");

    await accounts.removeHome("work");

    await signIn.ended;
    await expect(stat(home("work"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await accounts.engineIdsWithHomes()).toEqual([]);
  });

  it("ends every Sign in under way as the service stops", async () => {
    const signIn = await accounts.signIn("work");

    await accounts.onModuleDestroy();
    await signIn.ended;
    await expect(accounts.account("work")).resolves.toEqual({ signedIn: false });
  });
});

describe("the device page and code in what `codex login --device-auth` printed", () => {
  it("waits until the code's line has ended", () => {
    const steps = `1. Open this link in your browser and sign in to your account\r\n   ${PAGE}\r\n\r\n2. Enter this one-time code (expires in 15 minutes)\r\n   ABCD-EF`;

    expect(pageAndCode(steps)).toBeUndefined();
    expect(pageAndCode(`${steps}GH1\r\n`)).toEqual({ url: PAGE, userCode: "ABCD-EFGH1" });
  });
});
