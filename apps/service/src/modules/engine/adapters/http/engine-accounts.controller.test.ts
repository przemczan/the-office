import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { EngineAccountChanged } from "../../domain/engine-events.js";
import type { INestApplication } from "@nestjs/common";
import { engineAccountSchema } from "@the-office/contracts";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { EngineAccountsModule } from "../../engine-accounts.module.js";
import { ClaudeCodeAccounts } from "../../ports/claude-code-accounts.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
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
});
