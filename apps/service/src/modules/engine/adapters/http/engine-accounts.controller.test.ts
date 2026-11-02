import type { INestApplication } from "@nestjs/common";
import { engineAccountSchema, engineSignInSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { EngineAccountChanged } from "../../domain/engine-events.js";
import { EngineAccountsModule } from "../../engine-accounts.module.js";
import { ClaudeCodeAccounts } from "../../ports/claude-code-accounts.js";
import { EngineSettingsRepository } from "../../ports/engine-settings-repository.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import {
  STAND_IN_SIGN_IN_PAGE,
  StandInClaudeCodeAccounts,
} from "../scripted/stand-in-claude-code-accounts.js";

let app: INestApplication;
let url: string;
let published: DomainEvent[];

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
  ({ app, url } = await startTestApplication({
    imports: [EventsModule, EventStreamModule, EngineAccountsModule],
    overrides: [
      { provide: EngineSettingsRepository, useValue: repository },
      { provide: ClaudeCodeAccounts, useValue: new StandInClaudeCodeAccounts() },
    ],
  }));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api/settings/engines/${path}`, {
    method: "POST",
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
    expect(await account("claude-code")).toEqual({ signedIn: false, email: null, plan: null });

    const signIn = await post("claude-code/sign-in");
    expect(signIn.status).toBe(200);
    expect(engineSignInSchema.parse(await signIn.json())).toEqual({ url: STAND_IN_SIGN_IN_PAGE });
    expect((await post("claude-code/sign-in/code", { code: "a-code" })).status).toBe(204);

    expect(await account("claude-code")).toEqual({
      signedIn: true,
      email: "stand-in@example.com",
      plan: "max",
    });
    await expect
      .poll(() => published)
      .toEqual([expect.objectContaining({ engineId: "claude-code" })]);
    expect(published[0]).toBeInstanceOf(EngineAccountChanged);
  });

  it("refuses an engine that is no Claude Code engine, or none listed", async () => {
    expect((await fetch(`${url}/api/settings/engines/strata/account`)).status).toBe(404);
    expect((await post("strata/sign-in")).status).toBe(404);
    expect((await post("unlisted/sign-in")).status).toBe(404);
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
