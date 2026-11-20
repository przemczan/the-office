import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { EngineAccountChanged } from "../../domain/engine-events.js";
import type { INestApplication } from "@nestjs/common";
import { engineAccountSchema, engineSignInSchema } from "@the-office/contracts";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { EngineModels } from "../../application/engine-models.js";
import { hasUsageWindows } from "../../domain/engines.js";
import { EngineAccountsModule } from "../../engine-accounts.module.js";
import { ClaudeCodeAccounts } from "../../ports/claude-code-accounts.js";
import { CodexAccounts } from "../../ports/codex-accounts.js";
import { CopilotCliAccounts } from "../../ports/copilot-cli-accounts.js";
import { GeminiCliHomes } from "../../ports/gemini-cli-homes.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import {
  STAND_IN_CODEX_SIGN_IN_PAGE,
  STAND_IN_CODEX_USER_CODE,
  StandInCodexAccounts,
} from "../scripted/stand-in-codex-accounts.js";
import { StandInClaudeCodeAccounts } from "../scripted/stand-in-claude-code-accounts.js";
import {
  STAND_IN_COPILOT_CLI_SIGN_IN_PAGE,
  STAND_IN_COPILOT_CLI_USER_CODE,
  StandInCopilotCliAccounts,
} from "../scripted/stand-in-copilot-cli-accounts.js";

// What engine-accounts.controller.test.ts and engine-accounts.controller.full.test.ts share.

/** The stand-in, telling what happened to each engine's folder. */
class FolderRecordingAccounts extends StandInClaudeCodeAccounts {
  readonly folders: string[] = [];

  override prepareConfigFolder(engineId: string): Promise<void> {
    this.folders.push(`made ${engineId}`);
    return super.prepareConfigFolder(engineId);
  }

  override removeConfigFolder(engineId: string): Promise<void> {
    this.folders.push(`removed ${engineId}`);
    return super.removeConfigFolder(engineId);
  }
}

/** The Codex stand-in, telling what happened to each engine's folder in the same list. */
class HomeRecordingCodexAccounts extends StandInCodexAccounts {
  constructor(private readonly folders: string[]) {
    super();
  }

  override prepareHome(engineId: string): Promise<void> {
    this.folders.push(`made ${engineId}`);
    return super.prepareHome(engineId);
  }

  override removeHome(engineId: string): Promise<void> {
    this.folders.push(`removed ${engineId}`);
    return super.removeHome(engineId);
  }
}

/** The Copilot CLI stand-in, telling what happened to each engine's folder in the same list. */
class HomeRecordingCopilotCliAccounts extends StandInCopilotCliAccounts {
  constructor(private readonly folders: string[]) {
    super();
  }

  override prepareHome(engineId: string): Promise<void> {
    this.folders.push(`made ${engineId}`);
    return super.prepareHome(engineId);
  }

  override removeHome(engineId: string): Promise<void> {
    this.folders.push(`removed ${engineId}`);
    return super.removeHome(engineId);
  }
}

/** The Gemini CLI folders, telling what happened to each engine's folder in the same list. */
class HomeRecordingGeminiCliHomes extends GeminiCliHomes {
  constructor(private readonly folders: string[]) {
    super();
  }

  prepareHome(engineId: string): Promise<void> {
    this.folders.push(`made ${engineId}`);
    return Promise.resolve();
  }

  removeHome(engineId: string): Promise<void> {
    this.folders.push(`removed ${engineId}`);
    return Promise.resolve();
  }
}

let app: INestApplication;

let url: string;

let published: DomainEvent[];

let accounts: FolderRecordingAccounts;

let codexAccounts: HomeRecordingCodexAccounts;

let copilotCliAccounts: HomeRecordingCopilotCliAccounts;

let repository: EngineSettingsForTests;

const TOKEN = "sk-ant-oat01-a-pasted-token_123";

const API_KEY = "sk-proj-an-openai-key_456";

const ANTHROPIC_API_KEY = "sk-ant-api03-an-anthropic-key_789";

const COPILOT_CLI_TOKEN = "github_pat_11ABCDEFG0123456789_aFineGrainedToken";

/** The token the repository keeps for the Copilot CLI engine, as only it reveals it. */
async function keptToken(engineId: string): Promise<string | null> {
  const engine = (await repository.read()).engines.find(({ id }) => id === engineId);
  return engine?.kind === "copilot-cli" ? (engine.token?.reveal() ?? null) : null;
}

const GEMINI_API_KEY = "AIzaSyAGeminiKey_0123456789";

/** The API key the repository keeps for the Gemini CLI engine, as only it reveals it. */
async function keptGeminiKey(engineId: string): Promise<string | null> {
  const engine = (await repository.read()).engines.find(({ id }) => id === engineId);
  return engine?.kind === "gemini-cli" ? (engine.apiKey?.reveal() ?? null) : null;
}

/** The API key the repository keeps for the engine, as only it reveals it. */
async function keptApiKey(engineId: string): Promise<string | null> {
  const engine = (await repository.read()).engines.find(({ id }) => id === engineId);
  return engine?.kind === "codex" ? (engine.apiKey?.reveal() ?? null) : null;
}

function post(path: string, body?: unknown): Promise<Response> {
  return send("POST", path, body);
}

function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api/settings/engines/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function account(engineId: string): Promise<unknown> {
  const response = await fetch(`${url}/api/settings/engines/${engineId}/account`);
  expect(response.status).toBe(200);
  return engineAccountSchema.parse(await response.json());
}

async function claudeCodeHasUsageWindows(): Promise<boolean | undefined> {
  const engine = await app.get(EngineModels).find("claude-code");
  return engine === undefined ? undefined : hasUsageWindows(engine);
}

/** The hooks every test of both files runs. */
function setUpEachTest(): void {
  beforeEach(async () => {
    repository = new EngineSettingsForTests();
    await repository.replace({
      ...(await repository.read()),
      engines: [
        ...(await repository.read()).engines,
        {
          id: "strata",
          name: "Strata",
          kind: "openai-compatible-api",
          defaultModel: "qwen3.8-flash",
          baseUrl: "http://127.0.0.1:8080/v1",
          key: "",
          models: [{ id: "qwen3.8-flash", contextWindow: 100_000 }],
        },
        { id: "codex", name: "Codex", kind: "codex", defaultModel: "gpt-6-luna", apiKey: null },
        { id: "copilot", name: "Copilot", kind: "copilot-cli", defaultModel: "auto", token: null },
        { id: "gemini", name: "Gemini", kind: "gemini-cli", defaultModel: "auto", apiKey: null },
      ],
    });
    accounts = new FolderRecordingAccounts();
    codexAccounts = new HomeRecordingCodexAccounts(accounts.folders);
    copilotCliAccounts = new HomeRecordingCopilotCliAccounts(accounts.folders);
    ({ app, url } = await startTestApplication({
      imports: [EventsModule, EventStreamModule, EngineAccountsModule],
      overrides: [
        { provide: EngineSettingsRepository, useValue: repository },
        { provide: ClaudeCodeAccounts, useValue: accounts },
        { provide: CodexAccounts, useValue: codexAccounts },
        { provide: CopilotCliAccounts, useValue: copilotCliAccounts },
        { provide: GeminiCliHomes, useValue: new HomeRecordingGeminiCliHomes(accounts.folders) },
      ],
    }));
    published = [];
    app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
  });

  afterEach(async () => {
    await app.close();
  });
}

setUpEachTest();

describe("/api/settings/engines/:engineId account and Sign in", () => {
  it("signs in by a pasted token, never answered back, and signs out", async () => {
    const pasted = await send("PUT", "claude-code/token", {
      token: ` ${TOKEN}
`,
    });

    expect(pasted.status).toBe(204);
    expect(await pasted.text()).toBe("");
    const signedIn = await fetch(`${url}/api/settings/engines/claude-code/account`);
    expect(await signedIn.text()).not.toContain("sk-ant");
    expect(await account("claude-code")).toEqual({
      signedIn: true,
      pastedToken: true,
      apiKey: false,
      email: null,
      plan: null,
    });

    expect((await send("DELETE", "claude-code/sign-in")).status).toBe(204);

    expect(await account("claude-code")).toMatchObject({ signedIn: false });
    expect(published).toEqual([expect.any(EngineAccountChanged), expect.any(EngineAccountChanged)]);
    expect(published).toMatchObject([{ engineId: "claude-code" }, { engineId: "claude-code" }]);
  });

  it("refuses an engine that is no Claude Code engine, or none listed", async () => {
    expect((await fetch(`${url}/api/settings/engines/strata/account`)).status).toBe(404);
    expect((await post("strata/sign-in")).status).toBe(404);
    expect((await post("unlisted/sign-in")).status).toBe(404);
    expect((await send("PUT", "strata/token", { token: TOKEN })).status).toBe(404);
    expect((await send("DELETE", "strata/sign-in")).status).toBe(404);
  });

  it("signs in a Codex engine by a device page and its one-time code", async () => {
    expect(await account("codex")).toEqual({
      signedIn: false,
      pastedToken: false,
      apiKey: false,
      email: null,
      plan: null,
    });

    const signIn = await post("codex/sign-in");
    expect(signIn.status).toBe(200);
    expect(engineSignInSchema.parse(await signIn.json())).toEqual({
      url: STAND_IN_CODEX_SIGN_IN_PAGE,
      userCode: STAND_IN_CODEX_USER_CODE,
    });
    expect(codexAccounts.approve("codex")).toBe(true);

    await expect.poll(() => published).toEqual([expect.any(EngineAccountChanged)]);
    expect(published).toMatchObject([{ engineId: "codex" }]);
    expect(await account("codex")).toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: false,
      email: "stand-in@example.com",
      plan: "plus",
    });
  });

  it("signs a Codex engine in by an API key, kept but never answered back, until a Sign in or Sign out", async () => {
    const given = await send("PUT", "codex/api-key", { key: ` ${API_KEY}\n` });

    expect(given.status).toBe(204);
    expect(await given.text()).toBe("");
    expect(await keptApiKey("codex")).toBe(API_KEY);
    const signedIn = await fetch(`${url}/api/settings/engines/codex/account`);
    expect(await signedIn.text()).not.toContain(API_KEY);
    expect(await account("codex")).toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: true,
      email: null,
      plan: null,
    });
    expect(JSON.stringify(published)).not.toContain(API_KEY);

    // A Sign in with ChatGPT takes the key's place.
    expect((await post("codex/sign-in")).status).toBe(200);
    expect(await keptApiKey("codex")).toBeNull();
    codexAccounts.approve("codex");
    await expect.poll(() => published).toHaveLength(2);
    expect(await account("codex")).toMatchObject({ apiKey: false, plan: "plus" });

    await send("PUT", "codex/api-key", { key: API_KEY });
    expect((await send("DELETE", "codex/sign-in")).status).toBe(204);

    expect(await keptApiKey("codex")).toBeNull();
    expect(await account("codex")).toMatchObject({ signedIn: false });
    expect(published).toHaveLength(4);
    expect(published).toMatchObject([
      { engineId: "codex" },
      { engineId: "codex" },
      { engineId: "codex" },
      { engineId: "codex" },
    ]);
  });

  it("signs a Claude Code engine in by an Anthropic API key, never answered back nor announced, until Sign out", async () => {
    const given = await send("PUT", "claude-code/api-key", { key: ` ${ANTHROPIC_API_KEY}\n` });

    expect(given.status).toBe(204);
    expect(await given.text()).toBe("");
    const signedIn = await fetch(`${url}/api/settings/engines/claude-code/account`);
    expect(await signedIn.text()).not.toContain("sk-ant");
    expect(await account("claude-code")).toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: true,
      email: null,
      plan: null,
    });
    expect(JSON.stringify(published)).not.toContain("sk-ant");
    // Listed with no usage windows by the time the change is announced.
    expect(await claudeCodeHasUsageWindows()).toBe(false);

    expect((await send("DELETE", "claude-code/sign-in")).status).toBe(204);

    expect(await account("claude-code")).toMatchObject({ signedIn: false });
    expect(await claudeCodeHasUsageWindows()).toBe(true);
    expect(published).toMatchObject([{ engineId: "claude-code" }, { engineId: "claude-code" }]);
  });

  it("refuses a Claude Code engine a key not shaped as an Anthropic API key, in plain words without naming it", async () => {
    for (const key of [API_KEY, TOKEN]) {
      const refused = await send("PUT", "claude-code/api-key", { key });

      expect(refused.status).toBe(400);
      const text = await refused.text();
      expect(text).not.toContain(key);
      expect(JSON.parse(text)).toMatchObject({
        message: "That is no Anthropic API key: one starts with sk-ant-api.",
      });
    }
    const blank = await send("PUT", "claude-code/api-key", { key: "   " });
    expect(blank.status).toBe(400);
    expect(await blank.text()).not.toContain("sk-");
    expect(await account("claude-code")).toMatchObject({ signedIn: false });
    expect(published).toEqual([]);
  });

  it("refuses an empty API key, and one for an engine with no account, without naming it", async () => {
    const empty = await send("PUT", "codex/api-key", { key: "   " });
    expect(empty.status).toBe(400);

    for (const engineId of ["strata", "unlisted"]) {
      const refused = await send("PUT", `${engineId}/api-key`, { key: API_KEY });

      expect(refused.status).toBe(404);
      expect(await refused.text()).not.toContain(API_KEY);
    }
    expect(await keptApiKey("codex")).toBeNull();
    expect(published).toEqual([]);
  });

  it("signs a Copilot CLI engine in by GitHub's device page and its one-time code", async () => {
    expect(await account("copilot")).toMatchObject({ signedIn: false });

    const signIn = await post("copilot/sign-in");
    expect(signIn.status).toBe(200);
    expect(engineSignInSchema.parse(await signIn.json())).toEqual({
      url: STAND_IN_COPILOT_CLI_SIGN_IN_PAGE,
      userCode: STAND_IN_COPILOT_CLI_USER_CODE,
    });
    expect(copilotCliAccounts.approve("copilot")).toBe(true);

    await expect.poll(() => published).toEqual([expect.any(EngineAccountChanged)]);
    expect(published).toMatchObject([{ engineId: "copilot" }]);
    expect(await account("copilot")).toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: false,
      email: "stand-in-octocat",
      plan: null,
    });

    expect((await send("DELETE", "copilot/sign-in")).status).toBe(204);
    expect(await account("copilot")).toMatchObject({ signedIn: false });
  });

  it("signs a Copilot CLI engine in by a pasted token, kept but never answered back, until a Sign in or Sign out", async () => {
    const pasted = await send("PUT", "copilot/token", { token: ` ${COPILOT_CLI_TOKEN}\n` });

    expect(pasted.status).toBe(204);
    expect(await pasted.text()).toBe("");
    expect(await keptToken("copilot")).toBe(COPILOT_CLI_TOKEN);
    const signedIn = await fetch(`${url}/api/settings/engines/copilot/account`);
    expect(await signedIn.text()).not.toContain("github_pat");
    expect(await account("copilot")).toEqual({
      signedIn: true,
      pastedToken: true,
      apiKey: false,
      email: null,
      plan: null,
    });
    expect(JSON.stringify(published)).not.toContain(COPILOT_CLI_TOKEN);
    const settings = await fetch(`${url}/api/settings/engines`);
    expect(await settings.text()).not.toContain("github_pat");

    // A Sign in takes the token's place.
    expect((await post("copilot/sign-in")).status).toBe(200);
    expect(await keptToken("copilot")).toBeNull();
    copilotCliAccounts.approve("copilot");
    await expect.poll(() => published).toHaveLength(2);
    expect(await account("copilot")).toMatchObject({ pastedToken: false, signedIn: true });

    // And a token takes the Sign in's place, the folder signed out.
    await send("PUT", "copilot/token", { token: COPILOT_CLI_TOKEN });
    await expect(copilotCliAccounts.account("copilot")).resolves.toEqual({ signedIn: false });
    expect((await send("DELETE", "copilot/sign-in")).status).toBe(204);

    expect(await keptToken("copilot")).toBeNull();
    expect(await account("copilot")).toMatchObject({ signedIn: false });
    expect(published).toHaveLength(4);
  });

  it("refuses a Copilot CLI engine what is no fine-grained token, in words without naming it", async () => {
    for (const token of [TOKEN, "ghp_aClassicToken123", "github_pat_cut short"]) {
      const refused = await send("PUT", "copilot/token", { token });

      expect(refused.status).toBe(400);
      const text = await refused.text();
      expect(text).not.toContain(token);
      expect(JSON.parse(text)).toMatchObject({
        message: expect.stringMatching(/fine-grained personal access token.*Copilot Requests/),
      });
    }
    expect(await keptToken("copilot")).toBeNull();
    expect(published).toEqual([]);
  });

  it("refuses a Copilot CLI engine an API key and a Sign in code", async () => {
    const refused = await send("PUT", "copilot/api-key", { key: COPILOT_CLI_TOKEN });
    expect(refused.status).toBe(404);
    expect(await refused.text()).not.toContain(COPILOT_CLI_TOKEN);
    expect((await post("copilot/sign-in/code", { code: "a-code" })).status).toBe(404);
  });

  it("signs a Gemini CLI engine in by an API key, kept but never answered back, until Sign out", async () => {
    expect(await account("gemini")).toMatchObject({ signedIn: false });

    const pasted = await send("PUT", "gemini/api-key", { key: ` ${GEMINI_API_KEY}\n` });

    expect(pasted.status).toBe(204);
    expect(await pasted.text()).toBe("");
    expect(await keptGeminiKey("gemini")).toBe(GEMINI_API_KEY);
    const signedIn = await fetch(`${url}/api/settings/engines/gemini/account`);
    expect(await signedIn.text()).not.toContain("AIza");
    expect(await account("gemini")).toEqual({
      signedIn: true,
      pastedToken: false,
      apiKey: true,
      email: null,
      plan: null,
    });
    expect(JSON.stringify(published)).not.toContain(GEMINI_API_KEY);
    const settings = await fetch(`${url}/api/settings/engines`);
    expect(await settings.text()).not.toContain("AIza");

    expect((await send("DELETE", "gemini/sign-in")).status).toBe(204);
    expect(await keptGeminiKey("gemini")).toBeNull();
    expect(await account("gemini")).toMatchObject({ signedIn: false });
  });

  it("refuses a Gemini CLI engine an empty API key in words, and a Sign in, a code and a token", async () => {
    const empty = await send("PUT", "gemini/api-key", { key: "  " });
    expect(empty.status).toBe(400);
    expect(JSON.parse(await empty.text())).toMatchObject({ message: expect.any(String) });
    expect(await keptGeminiKey("gemini")).toBeNull();

    expect((await post("gemini/sign-in")).status).toBe(404);
    expect((await post("gemini/sign-in/code", { code: "a-code" })).status).toBe(404);
    expect((await send("PUT", "gemini/token", { token: TOKEN })).status).toBe(404);
  });

  it("refuses a Codex engine what only a Claude Code engine takes", async () => {
    expect((await post("codex/sign-in/code", { code: "a-code" })).status).toBe(404);
    expect((await send("PUT", "codex/token", { token: TOKEN })).status).toBe(404);
  });
});
