import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import type { ApiEndpoint } from "../../domain/api-endpoints.js";
import type { PermissionProfile } from "../../domain/permission-profile.js";
import {
  describeAgentEngineContract,
  type ContractScenario,
} from "../../ports/agent-engine.contract.js";
import { ModelNotOffered, SessionSkillsDiffer } from "../../ports/agent-engine.js";
import type { OfficeTool } from "../../ports/office-tool.js";
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

/** The shells the SDK adapter lists on this system, in its order. */
const SHELL_TOOLS = currentOperatingSystem().agentShells.map(({ shell }) =>
  shell === "bash" ? "Bash" : "PowerShell",
);

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
    case "office-tool":
      return [toolCall("mcp__office__note", { word: "tangerine" }), textReply(["done"], USAGE)];
    case "barge-in":
      return [toolCall("mcp__office__hold", {}), textReply(["done extra"], USAGE)];
    case "later":
      return [
        toolCall("mcp__office__hold", {}),
        textReply(["done"], USAGE),
        textReply(["later"], USAGE),
      ];
    case "interrupt":
      return [toolCall("mcp__office__hold", {}), textReply(["back"], USAGE)];
    case "output-schema":
      return [toolCall("StructuredOutput", { word: "ready" }), textReply(["ready"], USAGE)];
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
      ...SHELL_TOOLS,
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
    fake.script(
      toolCall("NotebookEdit", { notebook_path: "a.ipynb" }),
      textReply(["Sorry."], USAGE),
    );

    const { events } = await oneTurn();

    expect(events.find((event) => event.kind === "tool-refused")).toMatchObject({
      tool: "NotebookEdit",
      refusedBy: "engine",
      reason: expect.stringContaining("No tool is named NotebookEdit"),
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

  describe("its shells", () => {
    const ANYTHING: PermissionProfile = { ...READ_ONLY, run: { kind: "anything" } };
    const environment = { ...inheritedEnvironment(), OFFICE_PROBE: "probed" };

    it("runs a command in the session's folder and environment, and reads back its exit code", async () => {
      fake.script(
        toolCall("Bash", { command: "echo $OFFICE_PROBE; pwd > where.txt; exit 3" }),
        textReply(["Done."], USAGE),
      );

      const { events, turn } = await oneTurn(options({ profile: ANYTHING, environment }));

      expect(turn.outcome).toBe("completed");
      expect(events.find((event) => event.kind === "tool-result")).toMatchObject({
        isError: true,
        text: "Exit code 3\nprobed",
      });
      expect(await readFile(join(folder, "where.txt"), "utf8")).not.toBe("");
    });

    it.runIf(SHELL_TOOLS.includes("PowerShell"))(
      "runs a PowerShell command line, with its exit code",
      async () => {
        fake.script(
          toolCall("PowerShell", { command: 'Write-Output "$env:OFFICE_PROBE"; exit 3' }),
          textReply(["Done."], USAGE),
        );

        const { events } = await oneTurn(options({ profile: ANYTHING, environment }));

        expect(events.find((event) => event.kind === "tool-result")).toMatchObject({
          isError: true,
          text: "Exit code 3\nprobed",
        });
      },
    );

    it("refuses a command the profile doesn't allow, and runs nothing", async () => {
      fake.script(toolCall("Bash", { command: "echo hi > made.txt" }), textReply(["No."], USAGE));

      const { events } = await oneTurn(options({ environment }));

      expect(events.find((event) => event.kind === "tool-refused")).toMatchObject({
        tool: "Bash",
        refusedBy: "office-rules",
      });
      await expect(readFile(join(folder, "made.txt"))).rejects.toThrow("ENOENT");
    });

    it("ends a command that runs out of its time, with what it started", async () => {
      fake.script(
        toolCall("Bash", { command: `${NODE_CHILD}`, timeout: 1500 }),
        textReply(["Too slow."], USAGE),
      );

      const { events } = await oneTurn(options({ profile: ANYTHING, environment }));

      expect(events.find((event) => event.kind === "tool-result")).toMatchObject({
        isError: true,
        text: expect.stringContaining("ran out of time after 1500 ms"),
      });
      expect(isRunning(await childProcessId(folder))).toBe(false);
    });

    it("ends a running command with every process it started on interrupt", async () => {
      fake.script(toolCall("Bash", { command: NODE_CHILD }), textReply(["Back."], USAGE));
      const started = await engineOn().start({
        id: randomUUID(),
        options: options({ profile: ANYTHING, environment }),
        brief: { id: "brief", text: "Begin." },
      });
      session = started;
      const events = started.events[Symbol.asyncIterator]();

      const child = await childProcessId(folder);
      await started.interrupt();
      const interrupted = await untilTurnEnds(events);
      started.send({ id: "after", text: "Go on." }, "next");
      const next = await untilTurnEnds(events);

      expect(isRunning(child)).toBe(false);
      expect(interrupted.turn).toMatchObject({
        outcome: "interrupted",
        consumedMessageIds: ["brief"],
      });
      expect(interrupted.events.find((event) => event.kind === "tool-result")).toMatchObject({
        isError: true,
        text: expect.stringContaining("The command was stopped."),
      });
      expect(next.turn).toMatchObject({ outcome: "completed", consumedMessageIds: ["after"] });
      const messages = lastRequestBody().messages;
      expect(messages.slice(-4).map((message) => message["role"])).toEqual([
        "assistant",
        "tool",
        "user",
        "user",
      ]);
    });
  });

  it("stops a request still streaming on interrupt, and keeps nothing of its answer", async () => {
    fake.script({ kind: "reply", text: ["Thinking"], stall: true }, textReply(["Back."], USAGE));
    const started = await engineOn().start({
      id: randomUUID(),
      options: options(),
      brief: { id: "brief", text: "Begin." },
    });
    session = started;
    const events = started.events[Symbol.asyncIterator]();
    let next = await events.next();
    while (!next.done && next.value.kind !== "text") next = await events.next();
    const streaming = fake.requests.at(-1);

    await started.interrupt();
    const { turn } = await untilTurnEnds(events);
    started.send({ id: "after", text: "Go on." }, "next");
    await untilTurnEnds(events);

    expect(turn.outcome).toBe("interrupted");
    expect(await streaming?.ended).toBe("closed-by-client");
    expect(lastRequestBody().messages.slice(1)).toEqual([
      { role: "user", content: "Begin." },
      { role: "user", content: "[The user interrupted this turn.]" },
      { role: "user", content: "Go on." },
    ]);
  });

  it("judges an Office tool again as it runs, so a hold begun meanwhile refuses it", async () => {
    const calls: unknown[] = [];
    const note: OfficeTool = {
      name: "note",
      description: "Notes down one word.",
      input: z.object({ word: z.string() }),
      run: (input) => {
        calls.push(input);
        return Promise.resolve({ text: "Noted.", isError: false });
      },
    };
    let asked = 0;
    fake.script(toolCall("mcp__office__note", { word: "hi" }), textReply(["Held."], USAGE));

    const { events } = await oneTurn(
      options({
        officeTools: [note],
        toolHold: () => Promise.resolve(++asked > 1 ? "The fire alarm is on." : undefined),
      }),
    );

    expect(events.find((event) => event.kind === "tool-call")).toMatchObject({
      tool: "note",
      officeTool: true,
    });
    expect(events.find((event) => event.kind === "tool-result")).toMatchObject({
      isError: true,
      text: "The fire alarm is on.",
    });
    expect(calls).toEqual([]);
  });

  describe("its output schema", () => {
    const schema = WORD_SCHEMA;

    it("offers StructuredOutput with the schema, refuses input that doesn't fit, and ends in what fits", async () => {
      fake.script(
        toolCall("StructuredOutput", { word: 7 }),
        toolCall("StructuredOutput", { word: "ready" }),
        textReply(["Done."], USAGE),
      );

      const { events, turn } = await oneTurn(options({ outputSchema: schema }));

      expect(events.find((event) => event.kind === "tool-refused")).toMatchObject({
        tool: "StructuredOutput",
        refusedBy: "engine",
        reason: expect.stringContaining("/word must be string"),
      });
      expect(turn).toMatchObject({ outcome: "completed", output: { word: "ready" } });
      const offered = lastRequestBody().tools.find(
        (tool) => tool.function.name === "StructuredOutput",
      );
      expect(offered?.function).toMatchObject({ parameters: schema });
    });

    it("reminds a model that answers without it, then fails the turn after the last reminder", async () => {
      fake.script(
        textReply(["One."], USAGE),
        textReply(["Two."], USAGE),
        textReply(["Three."], USAGE),
      );

      const { turn } = await oneTurn(options({ outputSchema: schema }));

      expect(turn).toMatchObject({
        outcome: "failed",
        output: undefined,
        errors: [expect.stringContaining("without calling StructuredOutput")],
      });
      expect(fake.requests.at(-1)?.body).toMatchObject({
        messages: expect.arrayContaining([
          { role: "user", content: expect.stringContaining("call the StructuredOutput tool") },
        ]),
      });
    });
  });
});

/** A command whose node child writes its id where `childProcessId` finds it, then runs on. */
const NODE_CHILD = `node -e "require('fs').writeFileSync('child.pid', String(process.pid)); setInterval(() => {}, 1000)"`;

async function childProcessId(folder: string): Promise<number> {
  for (;;) {
    const text = await readFile(join(folder, "child.pid"), "utf8").catch(() => "");
    if (text !== "") return Number(text);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const WORD_SCHEMA = {
  type: "object",
  properties: { word: { type: "string" } },
  required: ["word"],
  additionalProperties: false,
};

function inheritedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

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
