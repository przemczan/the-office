import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { EngineAccountChanged } from "../../domain/engine-events.js";
import type { INestApplication } from "@nestjs/common";
import { engineAccountSchema, engineSignInSchema } from "@the-office/contracts";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { EngineAccountsModule } from "../../engine-accounts.module.js";
import { ClaudeCodeAccounts } from "../../ports/claude-code-accounts.js";
import { CodexAccounts } from "../../ports/codex-accounts.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import {
  STAND_IN_CODEX_SIGN_IN_PAGE,
  STAND_IN_CODEX_USER_CODE,
  StandInCodexAccounts,
} from "../scripted/stand-in-codex-accounts.js";
import { StandInClaudeCodeAccounts } from "../scripted/stand-in-claude-code-accounts.js";

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

let app: INestApplication;

let url: string;

let published: DomainEvent[];

let accounts: FolderRecordingAccounts;

let codexAccounts: HomeRecordingCodexAccounts;

let repository: EngineSettingsForTests;

const TOKEN = "sk-ant-oat01-a-pasted-token_123";

const API_KEY = "sk-proj-an-openai-key_456";

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
      ],
    });
    accounts = new FolderRecordingAccounts();
    codexAccounts = new HomeRecordingCodexAccounts(accounts.folders);
    ({ app, url } = await startTestApplication({
      imports: [EventsModule, EventStreamModule, EngineAccountsModule],
      overrides: [
        { provide: EngineSettingsRepository, useValue: repository },
        { provide: ClaudeCodeAccounts, useValue: accounts },
        { provide: CodexAccounts, useValue: codexAccounts },
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

  it("refuses an empty API key, and one for an engine that is no Codex engine, without naming it", async () => {
    const empty = await send("PUT", "codex/api-key", { key: "   " });
    expect(empty.status).toBe(400);

    for (const engineId of ["claude-code", "strata", "unlisted"]) {
      const refused = await send("PUT", `${engineId}/api-key`, { key: API_KEY });

      expect(refused.status).toBe(404);
      expect(await refused.text()).not.toContain(API_KEY);
    }
    expect(await keptApiKey("codex")).toBeNull();
    expect(published).toEqual([]);
  });

  it("refuses a Codex engine what only a Claude Code engine takes", async () => {
    expect((await post("codex/sign-in/code", { code: "a-code" })).status).toBe(404);
    expect((await send("PUT", "codex/token", { token: TOKEN })).status).toBe(404);
  });
});
