import type { INestApplication } from "@nestjs/common";
import { engineAccountSchema, engineSignInSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { EngineSettingsService } from "../../application/engine-settings-service.js";
import { EngineAccountChanged } from "../../domain/engine-events.js";
import { FIRST_OFFICE_DEFAULT, type EngineSettingsEdit } from "../../domain/engine-settings.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import { EngineAccountsModule } from "../../engine-accounts.module.js";
import { ClaudeCodeAccounts } from "../../ports/claude-code-accounts.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import {
  STAND_IN_SIGN_IN_PAGE,
  StandInClaudeCodeAccounts,
} from "../scripted/stand-in-claude-code-accounts.js";

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
    const edit = async (engines: EngineSettingsEdit["engines"]): Promise<void> => {
      await service.change({
        engines,
        officeDefault: FIRST_OFFICE_DEFAULT,
        searchEndpoint: null,
        modelPrices: [],
      });
    };
    const second = { name: "Second account", kind: "claude-code", claudeCodeP: false } as const;
    await edit([FIRST_CLAUDE_CODE_ENGINE, { ...second, defaultModel: "claude-haiku-5-5" }]);
    await post("second-account/sign-in");
    await post("second-account/sign-in/code", { code: "a-code" });

    await edit([FIRST_CLAUDE_CODE_ENGINE]);

    // The API engine Strata, removed too, has no folder.
    expect(accounts.folders).toEqual(["made second-account", "removed second-account"]);
    await expect(accounts.account("second-account")).resolves.toEqual({ signedIn: false });
  });

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
      email: null,
      plan: null,
    });

    expect((await send("DELETE", "claude-code/sign-in")).status).toBe(204);

    expect(await account("claude-code")).toMatchObject({ signedIn: false });
    expect(published).toEqual([expect.any(EngineAccountChanged), expect.any(EngineAccountChanged)]);
    expect(published).toMatchObject([{ engineId: "claude-code" }, { engineId: "claude-code" }]);
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

  it("refuses an engine that is no Claude Code engine, or none listed", async () => {
    expect((await fetch(`${url}/api/settings/engines/strata/account`)).status).toBe(404);
    expect((await post("strata/sign-in")).status).toBe(404);
    expect((await post("unlisted/sign-in")).status).toBe(404);
    expect((await send("PUT", "strata/token", { token: TOKEN })).status).toBe(404);
    expect((await send("DELETE", "strata/sign-in")).status).toBe(404);
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
