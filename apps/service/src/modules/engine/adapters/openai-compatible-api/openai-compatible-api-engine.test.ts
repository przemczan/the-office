import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { ApiEndpoint } from "../../domain/api-endpoints.js";
import type { PermissionProfile } from "../../domain/permission-profile.js";
import {
  describeAgentEngineContract,
  type ContractScenario,
} from "../../ports/agent-engine.contract.js";
import { ModelNotOffered, SessionSkillsDiffer } from "../../ports/agent-engine.js";
import type { EngineSession } from "../../ports/engine-session.js";
import { EngineSettingsForTests } from "../../ports/engine-settings-repository.fixtures.js";
import type { SessionEvent, TurnEndedEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import {
  FakeChatCompletionsServer,
  textReply,
  type ScriptedAnswer,
  type ScriptedReply,
} from "./fake-chat-completions-server.fixtures.js";
import {
  OPENAI_COMPATIBLE_API_CAPABILITIES,
  OpenAiCompatibleApiEngine,
} from "./openai-compatible-api-engine.js";

const USAGE = { prompt: 120, completion: 8 };

let fake: FakeChatCompletionsServer;

beforeAll(async () => {
  fake = await FakeChatCompletionsServer.start();
});

afterAll(async () => {
  await fake.close();
});

function endpoint(models = [{ id: "coder:q4", contextWindow: 100_000 }]): ApiEndpoint {
  return { id: "local", name: "Local", baseUrl: fake.baseUrl, key: "", models };
}

function engineOn(endpoints: readonly ApiEndpoint[] = [endpoint()]): OpenAiCompatibleApiEngine {
  return new OpenAiCompatibleApiEngine(
    new EngineSettingsForTests({ apiEndpoints: endpoints, searchEndpoint: null }),
    new OfficeDataDirectory(join(tmpdir(), "office-data-of-no-test")),
  );
}

function toolCall(name: string, input: unknown): ScriptedReply {
  return {
    kind: "reply",
    toolCalls: [{ name, arguments: [typeof input === "string" ? input : JSON.stringify(input)] }],
    usage: USAGE,
  };
}

/** What the fake server answers in each contract scenario the engine runs a request in. */
function contractAnswers(scenario: ContractScenario): ScriptedAnswer[] {
  switch (scenario) {
    case "reply":
      return [textReply(["read", "y"], USAGE)];
    case "refusal":
      return [
        toolCall("Write", { file_path: "notes.txt", content: "hi" }),
        textReply(["refused"], USAGE),
      ];
    default:
      return [];
  }
}

describeAgentEngineContract("OpenAiCompatibleApiEngine on a fake server", {
  capabilities: OPENAI_COMPATIBLE_API_CAPABILITIES,
  model: "local/coder:q4",
  timeoutMs: 10_000,
  async engineFor(scenario) {
    fake.script(...contractAnswers(scenario));
    return engineOn();
  },
});

const READ_ONLY: PermissionProfile = { edit: false, run: { kind: "read-only-git" }, web: false };
const EDITS: PermissionProfile = { ...READ_ONLY, edit: true };

describe("OpenAiCompatibleApiEngine's loop", () => {
  let folder: string;
  let session: EngineSession | undefined;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-api-loop-"));
  });

  afterEach(async () => {
    await session?.end();
    session = undefined;
    await rm(folder, { recursive: true, force: true });
  });

  function options(changes: Partial<SessionOptions> = {}): SessionOptions {
    return {
      folder,
      environment: {},
      model: "local/coder:q4",
      effort: "low",
      instructions: "You are the Developer.",
      skills: undefined,
      profile: READ_ONLY,
      officeTools: [],
      outputSchema: undefined,
      ...changes,
    };
  }

  async function oneTurn(
    sessionOptions: SessionOptions = options(),
  ): Promise<{ events: SessionEvent[]; turn: TurnEndedEvent }> {
    const started = await engineOn().start({
      id: randomUUID(),
      options: sessionOptions,
      brief: { id: "brief", text: "Begin." },
    });
    session = started;
    return untilTurnEnds(started.events[Symbol.asyncIterator]());
  }

  it("streams the reply, sends the system prompt and the tools, and counts the turn's tokens", async () => {
    fake.script(textReply(["Hello", " there."], { prompt: 300, completion: 4, cached: 100 }));

    const { events, turn } = await oneTurn();

    expect(events.filter((event) => event.kind === "text").map((event) => event.text)).toEqual([
      "Hello",
      " there.",
    ]);
    expect(turn).toMatchObject({
      outcome: "completed",
      consumedMessageIds: ["brief"],
      usage: { input: 200, output: 4, cacheRead: 100, cacheCreation: 0 },
      sessionCostUsd: 0,
      output: undefined,
    });
    const body = lastRequestBody();
    expect(body.model).toBe("coder:q4");
    expect(body.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("You are the Developer."),
    });
    expect(body.messages[1]).toEqual({ role: "user", content: "Begin." });
    expect(body.tools.map((tool) => tool.function.name)).toEqual([
      "Read",
      "Grep",
      "Glob",
      "Edit",
      "Write",
    ]);
  });

  it("runs a call the Office rules allow and sends its result back", async () => {
    await writeFile(join(folder, "notes.txt"), "first\nsecond\n");
    fake.script(
      toolCall("Read", { file_path: join(folder, "notes.txt") }),
      textReply(["Done."], USAGE),
    );

    const { events, turn } = await oneTurn();

    const call = events.find((event) => event.kind === "tool-call");
    expect(call).toMatchObject({
      tool: "Read",
      officeTool: false,
      input: { file_path: join(folder, "notes.txt") },
    });
    const result = events.find((event) => event.kind === "tool-result");
    expect(result).toMatchObject({ isError: false, text: "     1\tfirst\n     2\tsecond" });
    expect(events.some((event) => event.kind === "tool-refused")).toBe(false);
    expect(events.some((event) => event.kind === "turn-tokens")).toBe(true);
    expect(turn.usage).toMatchObject({ input: 240, output: 16 });
    expect(lastRequestBody().messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: call?.kind === "tool-call" ? call.callId : "",
      content: "     1\tfirst\n     2\tsecond",
    });
  });

  it("edits a file it read when the profile allows edits", async () => {
    const file = join(folder, "notes.txt");
    await writeFile(file, "draft\n");
    fake.script(
      toolCall("Read", { file_path: file }),
      toolCall("Edit", { file_path: file, old_string: "draft", new_string: "final" }),
      textReply(["Edited."], USAGE),
    );

    const { turn } = await oneTurn(options({ profile: EDITS }));

    expect(turn.outcome).toBe("completed");
    expect(await readFile(file, "utf8")).toBe("final\n");
  });

  it("refuses a read outside the session's folders in the rules' words", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "office-api-elsewhere-"));
    await writeFile(join(elsewhere, "secret.txt"), "no");
    fake.script(
      toolCall("Read", { file_path: join(elsewhere, "secret.txt") }),
      textReply(["No."], USAGE),
    );

    try {
      const { events } = await oneTurn();

      const refusal = events.find((event) => event.kind === "tool-refused");
      expect(refusal).toMatchObject({
        tool: "Read",
        refusedBy: "office-rules",
        reason: expect.stringContaining("outside this session's folders"),
      });
      const result = events.find((event) => event.kind === "tool-result");
      expect(result).toMatchObject({
        isError: true,
        text: refusal?.kind === "tool-refused" ? refusal.reason : "",
      });
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("refuses every call in the hold's words while The Office holds them", async () => {
    await writeFile(join(folder, "notes.txt"), "hi");
    fake.script(
      toolCall("Read", { file_path: join(folder, "notes.txt") }),
      textReply(["Held."], USAGE),
    );

    const { events } = await oneTurn(
      options({ toolHold: () => Promise.resolve("The fire alarm is on; every tool call waits.") }),
    );

    expect(events.find((event) => event.kind === "tool-refused")).toMatchObject({
      refusedBy: "office-rules",
      reason: "The fire alarm is on; every tool call waits.",
    });
  });

  it("tells the model the parse error of arguments that aren't JSON, and runs nothing", async () => {
    fake.script(
      toolCall("Write", '{"file_path": "a.txt", "content": '),
      textReply(["Sorry."], USAGE),
    );

    const { events, turn } = await oneTurn(options({ profile: EDITS }));

    expect(turn.outcome).toBe("completed");
    expect(events.find((event) => event.kind === "tool-call")).toMatchObject({
      input: '{"file_path": "a.txt", "content": ',
    });
    expect(events.find((event) => event.kind === "tool-refused")).toMatchObject({
      refusedBy: "engine",
      reason: expect.stringContaining("aren't valid JSON"),
    });
    expect(lastRequestBody().messages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("aren't valid JSON"),
    });
  });

  it("refuses input the tool can't take before the Office rules judge it", async () => {
    fake.script(toolCall("Read", { path: "notes.txt" }), textReply(["Sorry."], USAGE));

    const { events } = await oneTurn();

    expect(events.find((event) => event.kind === "tool-refused")).toMatchObject({
      refusedBy: "engine",
      reason: expect.stringContaining("file_path"),
    });
  });

  it("refuses a tool the session doesn't have", async () => {
    fake.script(toolCall("Bash", { command: "ls" }), textReply(["Sorry."], USAGE));

    const { events } = await oneTurn();

    expect(events.find((event) => event.kind === "tool-refused")).toMatchObject({
      tool: "Bash",
      refusedBy: "engine",
      reason: expect.stringContaining("No tool is named Bash"),
    });
  });

  it("ends a turn failed in the API endpoint's words, and takes the next message", async () => {
    fake.script(
      {
        kind: "status",
        status: 503,
        body: JSON.stringify({ error: { message: "Loading model" } }),
      },
      textReply(["Back."], USAGE),
    );
    const started = await engineOn().start({
      id: randomUUID(),
      options: options(),
      brief: { id: "brief", text: "Begin." },
    });
    session = started;
    const events = started.events[Symbol.asyncIterator]();

    const failed = await untilTurnEnds(events);
    started.send({ id: "again", text: "Again." }, "later");
    const next = await untilTurnEnds(events);

    expect(failed.turn).toMatchObject({
      outcome: "failed",
      errors: [expect.stringContaining("Local")],
    });
    expect(next.turn).toMatchObject({ outcome: "completed", consumedMessageIds: ["again"] });
  });

  it("refuses a Role card naming an API endpoint or model no longer listed", async () => {
    const engine = engineOn([endpoint([{ id: "other", contextWindow: 8000 }])]);
    const start = (model: string) =>
      engine.start({
        id: randomUUID(),
        options: options({ model }),
        brief: { id: "b", text: "Hi." },
      });

    await expect(start("removed/coder:q4")).rejects.toThrow(ModelNotOffered);
    await expect(start("removed/coder:q4")).rejects.toThrow(
      "Settings › Engines lists no API endpoint removed",
    );
    await expect(start("local/coder:q4")).rejects.toThrow("Local lists no model coder:q4");
    await expect(start("claude-haiku-5-5")).rejects.toThrow(ModelNotOffered);
  });

  it("doesn't start a session that must list skills, since it lists none yet", async () => {
    const start = engineOn().start({
      id: "s-1",
      options: options({
        skills: { folder, names: ["review"], expected: ["review"], overrides: {} },
      }),
      brief: { id: "b", text: "Hi." },
    });

    await expect(start).rejects.toThrow(SessionSkillsDiffer);
  });
});

interface RecordedBody {
  readonly model: string;
  readonly messages: readonly Record<string, unknown>[];
  readonly tools: readonly { readonly function: { readonly name: string } }[];
}

function lastRequestBody(): RecordedBody {
  return fake.requests.at(-1)?.body as RecordedBody;
}

async function untilTurnEnds(
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
