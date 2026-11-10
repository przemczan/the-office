import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { SdkMcpClient } from "../../../../platform/mcp/sdk-mcp-client.js";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { ApiEngine } from "../../domain/engines.js";
import type { SearchEndpoint } from "../../domain/engine-settings.js";
import type { PermissionProfile } from "../../domain/permission-profile.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import type { SessionEvent, TurnEndedEvent } from "../../ports/session-events.js";
import {
  FakeChatCompletionsServer,
  type ScriptedReply,
} from "./fake-chat-completions-server.fixtures.js";
import { OpenAiCompatibleApiEngine } from "./openai-compatible-api-engine.js";

// What openai-compatible-api-engine.test.ts and openai-compatible-api-engine.full.test.ts share:
// the fake server each test runs on, the engine on it, and reading a turn's events.

export const USAGE = { prompt: 120, completion: 8 };

export let fake: FakeChatCompletionsServer;
export let officeData: string;

/**
 * A server and an Office data folder per test: under load a slow test's session may still ask for
 * answers once it is over, and with a shared server it took those scripted for the next tests.
 */
export function eachTestOnAFakeServer(): void {
  beforeEach(async () => {
    fake = await FakeChatCompletionsServer.start();
    officeData = await mkdtemp(join(tmpdir(), "office-api-data-"));
  });

  afterEach(async () => {
    await fake.close();
    await rm(officeData, { recursive: true, force: true });
  });
}

export function endpoint(models = [{ id: "coder:q4", contextWindow: 100_000 }]): ApiEngine {
  return {
    id: "local",
    name: "Local",
    kind: "openai-compatible-api",
    defaultModel: models[0]?.id ?? "",
    baseUrl: fake.baseUrl,
    key: "",
    models,
  };
}

export function engineOn(
  endpoints: readonly ApiEngine[] = [endpoint()],
  searchEndpoint: SearchEndpoint | null = null,
): OpenAiCompatibleApiEngine {
  return new OpenAiCompatibleApiEngine(
    new EngineSettingsForTests({ engines: endpoints, searchEndpoint, modelPrices: [] }),
    new OfficeDataDirectory(officeData),
    new SdkMcpClient(),
  );
}

export function toolCall(name: string, input: unknown): ScriptedReply {
  return {
    kind: "reply",
    toolCalls: [{ name, arguments: [typeof input === "string" ? input : JSON.stringify(input)] }],
    usage: USAGE,
  };
}

export const READ_ONLY: PermissionProfile = {
  edit: false,
  run: { kind: "read-only-git" },
  web: false,
  mcpTools: {},
};

export async function untilTurnEnds(
  events: AsyncIterator<SessionEvent>,
): Promise<{ events: SessionEvent[]; turn: TurnEndedEvent }> {
  const seen: SessionEvent[] = [];
  for (;;) {
    const next = await events.next();
    if (next.done) throw new Error("The session ended before its turn did.");
    seen.push(next.value);
    if (next.value.kind === "turn-ended") return { events: seen, turn: next.value };
  }
}
