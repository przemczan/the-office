import { engineSignInSchema, engineAccountSchema } from "@the-office/contracts";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { EngineAccounts } from "../../application/engine-accounts.js";
import { EngineSettingsService } from "../../application/engine-settings-service.js";
import { RunningEngineSessions } from "../../application/running-engine-sessions.js";
import { EngineAccountChanged } from "../../domain/engine-events.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import { PastedToken } from "../../domain/pasted-token.js";
import {
  STAND_IN_SIGN_IN_PAGE,
  StandInClaudeCodeAccounts,
} from "../scripted/stand-in-claude-code-accounts.js";
import type { INestApplication } from "@nestjs/common";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { EngineAccountsModule } from "../../engine-accounts.module.js";
import { ClaudeCodeAccounts } from "../../ports/claude-code-accounts.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";

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

let app: INestApplication;

let url: string;

let published: DomainEvent[];

let accounts: FolderRecordingAccounts;

const TOKEN = "sk-ant-oat01-a-pasted-token_123";

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
    const repository = new EngineSettingsForTests();
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
      ],
    });
    accounts = new FolderRecordingAccounts();
    ({ app, url } = await startTestApplication({
      imports: [EventsModule, EventStreamModule, EngineAccountsModule],
      overrides: [
        { provide: EngineSettingsRepository, useValue: repository },
        { provide: ClaudeCodeAccounts, useValue: accounts },
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

/** Adds the Claude Code engine "Second account", whose id is `second-account`. */
async function addSecondAccount(service: EngineSettingsService): Promise<void> {
  const stored = await service.current();
  await service.change({
    ...stored,
    engines: [
      ...stored.engines,
      {
        name: "Second account",
        kind: "claude-code",
        claudeCodeP: false,
        defaultModel: "claude-haiku-5-5",
      },
    ],
  });
}

describe("/api/settings/engines/:engineId account and Sign in", () => {
  it("reads a Claude Code engine signed out until a Sign in takes its code", async () => {
    expect(await account("claude-code")).toEqual({
      signedIn: false,
      pastedToken: false,
      email: null,
      plan: null,
    });

    const signIn = await post("claude-code/sign-in");
    expect(signIn.status).toBe(200);
    expect(engineSignInSchema.parse(await signIn.json())).toEqual({ url: STAND_IN_SIGN_IN_PAGE });
    expect((await post("claude-code/sign-in/code", { code: "a-code" })).status).toBe(204);

    expect(await account("claude-code")).toEqual({
      signedIn: true,
      pastedToken: false,
      email: "stand-in@example.com",
      plan: "max",
    });
    await expect
      .poll(() => published)
      .toEqual([expect.objectContaining({ engineId: "claude-code" })]);
    expect(published[0]).toBeInstanceOf(EngineAccountChanged);
  });

  it("makes a Claude Code engine's folder when it is added, and removes it, signed out, with it", async () => {
    const service = app.get(EngineSettingsService);
    await addSecondAccount(service);
    await post("second-account/sign-in");
    await post("second-account/sign-in/code", { code: "a-code" });

    await service.remove("second-account", FIRST_CLAUDE_CODE_ENGINE.id);
    // The API engine Strata has no folder.
    await service.remove("strata", FIRST_CLAUDE_CODE_ENGINE.id);

    await expect
      .poll(() => accounts.folders)
      .toEqual(["made second-account", "removed second-account"]);
    await expect(accounts.account("second-account")).resolves.toEqual({ signedIn: false });
  });

  it("removes a removed engine's folder only once the sessions running on it have ended", async () => {
    const service = app.get(EngineSettingsService);
    await addSecondAccount(service);
    const ended = app.get(RunningEngineSessions).started("second-account");

    await service.remove("second-account", FIRST_CLAUDE_CODE_ENGINE.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(accounts.folders).toEqual(["made second-account"]);

    ended();
    await expect
      .poll(() => accounts.folders)
      .toEqual(["made second-account", "removed second-account"]);
  });

  it("keeps the folder of an engine added again under its name while its sessions ran", async () => {
    const service = app.get(EngineSettingsService);
    await addSecondAccount(service);
    const running = app.get(RunningEngineSessions);
    const ended = running.started("second-account");
    await service.remove("second-account", FIRST_CLAUDE_CODE_ENGINE.id);
    await addSecondAccount(service);

    ended();
    await running.allEnded("second-account");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(accounts.folders).toEqual(["made second-account", "made second-account"]);
  });

  it("removes the folder of every engine no longer listed as the service starts", async () => {
    // Left by a removal whose sessions outlasted the service, and a listed engine signed in.
    await accounts.setPastedToken("left-behind", PastedToken.of(TOKEN));
    await accounts.setPastedToken("claude-code", PastedToken.of(TOKEN));

    await app.get(EngineAccounts).onApplicationBootstrap();

    expect(accounts.folders).toEqual(["removed left-behind"]);
    expect(await accounts.engineIdsWithConfigFolders()).toEqual(["claude-code"]);
  });

  it("refuses what is no `claude setup-token` token without naming it", async () => {
    for (const token of ["sk-ant-api03-a-console-key", "sk-ant-oat01-cut short", "a-code"]) {
      const refused = await send("PUT", "claude-code/token", { token });

      expect(refused.status).toBe(400);
      const answer = await refused.text();
      expect(answer).toMatch(/claude setup-token/);
      expect(answer).not.toContain(token);
    }
    expect((await send("PUT", "claude-code/token", { token: "  " })).status).toBe(400);
    expect(await account("claude-code")).toMatchObject({ signedIn: false });
    expect(published).toEqual([]);
  });

  it("refuses a code with no Sign in under way, and an empty one", async () => {
    const refused = await post("claude-code/sign-in/code", { code: "a-code" });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      message: expect.stringMatching(/start one again/),
    });
    expect((await post("claude-code/sign-in/code", { code: "  " })).status).toBe(400);
  });
});
