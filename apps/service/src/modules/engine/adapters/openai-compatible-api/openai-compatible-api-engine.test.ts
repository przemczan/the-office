import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiEngine } from "../../domain/engines.js";
import {
  describeAgentEngineContract,
  type ContractScenario,
} from "../../ports/agent-engine.contract.js";
import { CONTRACT_MCP_SERVER } from "../mcp-servers/contract-mcp-server.fixtures.js";
import type { EngineSession } from "../../ports/engine-session.js";
import type { SessionEvent, TurnEndedEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";
import {
  textReply,
  type ScriptedAnswer,
  type ScriptedReply,
  type ScriptedStatus,
} from "./fake-chat-completions-server.fixtures.js";
import {
  OPENAI_COMPATIBLE_API_CAPABILITIES,
  OpenAiCompatibleApiEngine,
} from "./openai-compatible-api-engine.js";
import {
  USAGE,
  fake,
  eachTestOnAFakeServer,
  endpoint,
  engineOn,
  toolCall,
  READ_ONLY,
  untilTurnEnds,
} from "./openai-compatible-api-engine.fixtures.js";

eachTestOnAFakeServer();

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
    case "resume":
      return [
        textReply(["ok"], USAGE),
        toolCall("mcp__office__note", { word: "tangerine" }),
        textReply(["done"], USAGE),
      ];
    case "context-usage":
      return [textReply(["ready"], USAGE)];
    case "skill-command":
      return [
        textReply(["ready"], USAGE),
        toolCall("mcp__office__note", { word: "tangerine" }),
        textReply(["done"], USAGE),
      ];
    case "mcp-tool":
      return [
        toolCall("mcp__fake__environment-variable", { name: "FAKE_SERVER_VALUE" }),
        toolCall("mcp__fake__started-process", {}),
        toolCall("mcp__fake__echo", { text: "hi" }),
        textReply(["done"], USAGE),
      ];
    case "background":
      return [
        toolCall("Bash", { command: COUNTING_COMMAND, run_in_background: true }),
        textReply(["started"], USAGE),
      ];
    case "background-stop":
      return [
        toolCall("Bash", { command: TICKING_COMMAND, run_in_background: true }),
        { kind: "from-request", answer: stopOfLastBackgroundCommand },
        textReply(["stopped"], USAGE),
      ];
    default:
      return [];
  }
}

/** The contract's commands, as its briefs give them to the model. */
const COUNTING_COMMAND = `node -e "for (let i = 1; i <= 3; i++) setTimeout(() => console.log('line ' + i), i * 1000)"`;
const TICKING_COMMAND = `node -e "setInterval(() => console.log('tick'), 500)"`;

/** A TaskStop call naming the background command the request's last tool result says started. */
function stopOfLastBackgroundCommand(body: unknown): ScriptedReply | ScriptedStatus {
  const { messages } = body as { messages: { role: string; content: string | null }[] };
  const result = messages.at(-1);
  const id = /with ID: (\S+)\./.exec(result?.role === "tool" ? (result.content ?? "") : "")?.[1];
  if (id === undefined) {
    return { kind: "status", status: 500, body: "The last message names no background command." };
  }
  return toolCall("TaskStop", { task_id: id });
}

describeAgentEngineContract("OpenAiCompatibleApiEngine on a fake server", {
  capabilities: OPENAI_COMPATIBLE_API_CAPABILITIES,
  // Read as each scenario starts, once the fake server listens.
  get engine() {
    return endpoint();
  },
  model: "coder:q4",
  timeoutMs: 10_000,
  mcpServer: CONTRACT_MCP_SERVER,
  backgroundCommands: true,
  async engineFor(scenario) {
    fake.script(...contractAnswers(scenario));
    return engineOn();
  },
});

/**
 * A live server is slow and its model may be weak, so the contract runs on it only when asked
 * (apps/service/docs/testing.md): OFFICE_ENGINE_TESTS=live with OFFICE_API_BASE_URL and
 * OFFICE_API_MODEL set; `-t` picks the scenarios worth a run.
 */
const LIVE_BASE_URL = process.env["OFFICE_API_BASE_URL"];
const LIVE_MODEL = process.env["OFFICE_API_MODEL"];

describe.runIf(process.env["OFFICE_ENGINE_TESTS"] === "live" && LIVE_BASE_URL && LIVE_MODEL)(
  "OpenAiCompatibleApiEngine on a live server",
  () => {
    const live: ApiEngine = {
      id: "live",
      name: "Live",
      kind: "openai-compatible-api",
      defaultModel: LIVE_MODEL ?? "",
      baseUrl: LIVE_BASE_URL ?? "",
      key: process.env["OFFICE_API_KEY"] ?? "",
      models: [{ id: LIVE_MODEL ?? "", contextWindow: 100_000 }],
    };

    describeAgentEngineContract("OpenAiCompatibleApiEngine", {
      capabilities: OPENAI_COMPATIBLE_API_CAPABILITIES,
      engine: live,
      model: LIVE_MODEL ?? "",
      timeoutMs: 30 * 60_000,
      mcpServer: CONTRACT_MCP_SERVER,
      backgroundCommands: true,
      engineFor: () => Promise.resolve(engineOn([live])),
    });
  },
);

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
      engine: endpoint(),
      model: "coder:q4",
      effort: "low",
      instructions: "You are the Developer.",
      skills: undefined,
      profile: READ_ONLY,
      officeTools: [],
      mcpServers: [],
      languageServers: [],
      outputSchema: undefined,
      ...changes,
    };
  }

  /** The options of a session on a model that sees images or doesn't. */
  function onModel(seesImages: boolean): SessionOptions {
    return options({
      engine: endpoint([{ id: "coder:q4", contextWindow: 100_000, seesImages }]),
    });
  }

  async function oneTurn(
    sessionOptions: SessionOptions = options(),
    engine: OpenAiCompatibleApiEngine = engineOn(),
  ): Promise<{ events: SessionEvent[]; turn: TurnEndedEvent }> {
    const started = await engine.start({
      id: randomUUID(),
      options: sessionOptions,
      brief: { id: "brief", text: "Begin." },
    });
    session = started;
    return untilTurnEnds(started.events[Symbol.asyncIterator]());
  }

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

  describe("a message's images", () => {
    const screenshot = {
      attachmentId: "0c6f5d1e-3a5b-4f0e-9a52-2d2f0e1c9b10",
      name: "screen.png",
      mediaType: "image/png",
      content: new Uint8Array([1, 2, 3]),
    };
    const brief = { id: "brief", text: "What is wrong here?", images: [screenshot] };

    it("go as image parts on a model that sees images, and come back on resume", async () => {
      const id = randomUUID();
      fake.script(textReply(["A typo."], USAGE));
      const first = await engineOn().start({ id, options: onModel(true), brief });
      session = first;
      await untilTurnEnds(first.events[Symbol.asyncIterator]());
      const parts = [
        { type: "text", text: "What is wrong here?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      ];
      expect(lastUserMessage()).toEqual({ role: "user", content: parts });
      await first.end();

      fake.script(textReply(["Fixed."], USAGE));
      const resumed = await engineOn().resume(id, onModel(true));
      session = resumed;
      resumed.send({ id: "again", text: "Again." }, "next");
      await untilTurnEnds(resumed.events[Symbol.asyncIterator]());

      expect(lastRequestMessages().slice(1)).toEqual([
        { role: "user", content: parts },
        { role: "assistant", content: "A typo." },
        { role: "user", content: "Again." },
      ]);
    });

    it("are named in words on a model that doesn't see images", async () => {
      fake.script(textReply(["I can't see it."], USAGE));

      session = await engineOn().start({ id: randomUUID(), options: onModel(false), brief });
      await untilTurnEnds(session.events[Symbol.asyncIterator]());

      expect(lastUserMessage()).toEqual({
        role: "user",
        content:
          "What is wrong here?\n\n[Image screen.png, Attachment 0c6f5d1e-3a5b-4f0e-9a52-2d2f0e1c9b10: this model can't see pictures; read_attachment gives its name and size only.]",
      });
    });

    it("are named in words on a model kept before Sees images was asked", async () => {
      fake.script(textReply(["I can't see it."], USAGE));
      session = await engineOn().start({ id: randomUUID(), options: options(), brief });
      await untilTurnEnds(session.events[Symbol.asyncIterator]());

      expect(lastUserMessage()).toMatchObject({
        content: expect.stringContaining("this model can't see pictures"),
      });
    });
  });
});

function lastRequestMessages(): readonly { readonly role: string }[] {
  const body = fake.requests.at(-1)?.body as { messages: { role: string }[] } | undefined;
  return body?.messages ?? [];
}

function lastUserMessage(): unknown {
  return lastRequestMessages()
    .filter(({ role }) => role === "user")
    .at(-1);
}
