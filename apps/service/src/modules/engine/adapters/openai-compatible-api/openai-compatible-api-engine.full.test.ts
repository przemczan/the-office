import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import { promptTemplatesFor } from "../../../prompt-templates/index.fixtures.js";
import { ENGINE_PROMPT_TEMPLATES } from "../../domain/engine-prompt-templates.js";
import { FIRST_CLAUDE_CODE_ENGINE } from "../../domain/engines.js";
import type { PermissionProfile } from "../../domain/permission-profile.js";
import { CONTRACT_MCP_SERVER } from "../mcp-servers/contract-mcp-server.fixtures.js";
import { FakeSearxngServer } from "../searxng/fake-searxng-server.fixtures.js";
import { ModelNotOffered, SessionSkillsDiffer } from "../../ports/agent-engine.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { EngineSession } from "../../ports/engine-session.js";
import type {
  ProcessStartedEvent,
  SessionEvent,
  TurnEndedEvent,
} from "../../ports/session-events.js";
import type { SessionOptions, SessionSkills } from "../../ports/session-options.js";
import { textReply } from "./fake-chat-completions-server.fixtures.js";
import { ConversationMissing } from "./conversation-file.js";
import {
  OPENAI_COMPATIBLE_API_CAPABILITIES,
  OpenAiCompatibleApiEngine,
} from "./openai-compatible-api-engine.js";
import {
  USAGE,
  fake,
  officeData,
  eachTestOnAFakeServer,
  endpoint,
  engineOn,
  toolCall,
  READ_ONLY,
  untilTurnEnds,
} from "./openai-compatible-api-engine.fixtures.js";

eachTestOnAFakeServer();

/** The shells the SDK adapter lists on this system, in its order. */
const SHELL_TOOLS = currentOperatingSystem().agentShells.map(({ shell }) =>
  shell === "bash" ? "Bash" : "PowerShell",
);
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

  it("declares it has no language servers, and offers no LSP tool", async () => {
    fake.script(textReply(["Noted."]));

    await oneTurn();

    expect(OPENAI_COMPATIBLE_API_CAPABILITIES.languageServers).toBe(false);
    expect(lastRequestBody().tools.map((tool) => tool.function.name)).not.toContain("LSP");
  });

  it("streams the reply, reports it whole, sends the system prompt and the tools, and counts the turn's tokens", async () => {
    fake.script(textReply(["Hello", " there."], { prompt: 300, completion: 4, cached: 100 }));

    const { events, turn } = await oneTurn();

    expect(fake.requests[0]?.body).toMatchObject({ stream: true });
    // As the SDK reports a text block: a Thread logs each text event as one message.
    expect(events.filter((event) => event.kind === "text").map((event) => event.text)).toEqual([
      "Hello there.",
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
      "TaskStop",
      "WebFetch",
      "WebSearch",
      "Skill",
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

  function startWith(changes: Partial<SessionOptions>): Promise<EngineSession> {
    return engineOn().start({
      id: randomUUID(),
      options: options(changes),
      brief: { id: "b", text: "Hi." },
    });
  }

  it("refuses a model its API endpoint doesn't list, or an engine that is no API endpoint", async () => {
    await expect(
      startWith({ engine: endpoint([{ id: "other", contextWindow: 8000 }]) }),
    ).rejects.toThrow("Local lists no model coder:q4");
    await expect(
      startWith({ engine: FIRST_CLAUDE_CODE_ENGINE, model: "claude-haiku-5-5" }),
    ).rejects.toThrow(ModelNotOffered);
  });

  it("gives the model the Project's instruction files that apply to every file", async () => {
    await writeFile(join(folder, "CLAUDE.md"), "Run the tests before you commit.\n");
    await mkdir(join(folder, ".claude", "rules"), { recursive: true });
    await writeFile(join(folder, ".claude", "rules", "style.md"), "Name things plainly.\n");
    await writeFile(
      join(folder, ".claude", "rules", "web.md"),
      "---\npaths: ['web/**']\n---\nUse the design system.\n",
    );
    await writeFile(join(folder, "CLAUDE.local.md"), "Only mine.\n");
    fake.script(textReply(["Ok."], USAGE));

    await oneTurn();

    const system = String(lastRequestBody().messages[0]?.["content"]);
    expect(system).toContain(
      `Contents of ${join(folder, "CLAUDE.md")} (project instructions, checked into the codebase):\n\nRun the tests before you commit.`,
    );
    expect(system).toContain("Name things plainly.");
    expect(system).not.toContain("Use the design system.");
    expect(system).not.toContain("Only mine.");
    expect(system.indexOf("Run the tests")).toBeLessThan(system.indexOf("You are the Developer."));
  });

  it("starts the conversation with the API system prompt text saved in Settings › Prompts, then the Agent's instructions", async () => {
    fake.script(textReply(["Ok."], USAGE));
    const templates = await promptTemplatesFor(ENGINE_PROMPT_TEMPLATES, [
      {
        key: "engine.api-system-prompt",
        text: "Work in {{folder}} on {{operatingSystem}}. {{#answersInSchema}}Use {{structuredOutputTool}}.{{/answersInSchema}}",
      },
    ]);

    await oneTurn(options(), engineOn(undefined, undefined, templates));

    expect(lastRequestBody().messages[0]).toEqual({
      role: "system",
      content: `Work in ${folder} on ${currentOperatingSystem().name}. \n\nYou are the Developer.`,
    });
  });

  describe("its skills", () => {
    let plugin: string;

    beforeEach(async () => {
      plugin = join(folder, "..", `${randomUUID()}-plugin`);
      await writeTextFile(join(plugin, ".claude-plugin", "plugin.json"), '{"name":"office"}');
      await writeTextFile(
        join(plugin, "skills", "tdd", "SKILL.md"),
        "---\nname: tdd\ndescription: Test first.\n---\n\nWrite the test, then $ARGUMENTS.\n",
      );
      await writeTextFile(
        join(folder, ".claude", "skills", "lint-all", "SKILL.md"),
        "---\nname: lint\ndescription: Lints the code.\n---\nRun the linter.\n",
      );
      await writeTextFile(join(folder, ".claude", "commands", "ops", "deploy.md"), "# Deploys\n");
    });

    afterEach(async () => {
      await rm(plugin, { recursive: true, force: true });
    });

    const allowingProject = (): SessionSkills => ({
      folder: plugin,
      names: ["office:tdd", "lint-all", "ops:deploy"],
      expected: ["lint", "office:tdd", "ops:deploy"],
      userOnly: [],
      overrides: {},
    });

    it("lists exactly its skills to the model, the Project's by the name they list as", async () => {
      fake.script(textReply(["Ok."], USAGE));

      await oneTurn(options({ skills: allowingProject() }));

      const skill = lastRequestBody().tools.find((tool) => tool.function.name === "Skill");
      expect(skill?.function.description).toContain(
        "Available skills:\n- lint: Lints the code.\n- office:tdd: Test first.\n- ops:deploy: Deploys",
      );
    });

    it("leaves out the Project's skills its Project turns off", async () => {
      fake.script(textReply(["Ok."], USAGE));

      await oneTurn(
        options({
          skills: {
            folder: plugin,
            names: ["office:tdd"],
            expected: ["office:tdd"],
            userOnly: [],
            overrides: { "lint-all": "off", "ops:deploy": "off" },
          },
        }),
      );

      const skill = lastRequestBody().tools.find((tool) => tool.function.name === "Skill");
      expect(skill?.function.description).toContain("Available skills:\n- office:tdd: Test first.");
      expect(skill?.function.description).not.toContain("lint");
    });

    it("doesn't start a session whose listing isn't exactly what it must list", async () => {
      const start = engineOn().start({
        id: "s-1",
        options: options({
          skills: { ...allowingProject(), expected: ["office:tdd", "review"] },
        }),
        brief: { id: "b", text: "Hi." },
      });

      await expect(start).rejects.toThrow(SessionSkillsDiffer);
      await expect(start).rejects.toThrow("It doesn't list review.");
      expect(fake.requests).toEqual([]);
    });

    it("loads a skill by its name, its arguments filled in, from the folder it is in", async () => {
      fake.script(
        toolCall("Skill", { skill: "office:tdd", args: "make it pass" }),
        toolCall("Skill", { skill: "/ops:deploy" }),
        toolCall("Skill", { skill: "review" }),
        textReply(["Done."], USAGE),
      );

      const { events } = await oneTurn(options({ skills: allowingProject() }));

      // Reported as Claude Code reports them, so EngineSessions counts a Skill use on every engine.
      const calls = events.filter((event) => event.kind === "tool-call");
      expect(calls).toMatchObject([
        { tool: "Skill", officeTool: false, input: { skill: "office:tdd" } },
        { tool: "Skill", officeTool: false, input: { skill: "/ops:deploy" } },
        { tool: "Skill", officeTool: false, input: { skill: "review" } },
      ]);
      const results = events.filter((event) => event.kind === "tool-result");
      expect(results).toMatchObject([
        {
          isError: false,
          text: `Base directory for this skill: ${join(plugin, "skills", "tdd")}\n\nWrite the test, then make it pass.`,
        },
        { isError: false, text: "# Deploys" },
        { isError: true, text: "Unknown skill: review" },
      ]);
      expect(events.some((event) => event.kind === "tool-refused")).toBe(false);
    });

    describe("only the user runs", () => {
      beforeEach(async () => {
        await writeTextFile(
          join(plugin, "skills", "release", "SKILL.md"),
          "---\nname: release\ndescription: Releases.\ndisable-model-invocation: true\n---\nRelease $ARGUMENTS now.\n",
        );
        await writeTextFile(
          join(folder, ".claude", "commands", "ship.md"),
          "---\ndisable-model-invocation: true\n---\nShip it.\n",
        );
      });

      it("starts without them in the model's listing, and its Skill tool refuses them", async () => {
        fake.script(toolCall("Skill", { skill: "office:release" }), textReply(["Ok."], USAGE));

        const { events } = await oneTurn(options({ skills: skillsWithUserOnly(plugin) }));

        const skill = fake.requests[0]?.body as RecordedBody;
        const description = skill.tools.find((tool) => tool.function.name === "Skill")?.function
          .description;
        expect(description).toContain(
          "Available skills:\n- lint: Lints the code.\n- office:tdd: Test first.\n- ops:deploy: Deploys",
        );
        expect(description).not.toContain("release");
        expect(description).not.toContain("ship");
        expect(events.filter((event) => event.kind === "tool-result")).toMatchObject([
          { isError: true, text: expect.stringContaining("only the user runs it") },
        ]);
      });

      it("runs a skill command as Claude Code expands it, a user-only skill too", async () => {
        fake.script(
          textReply(["Briefed."], USAGE),
          textReply(["Released."], USAGE),
          textReply(["Tested."], USAGE),
          textReply(["Shipped."], USAGE),
          textReply(["Unknown."], USAGE),
        );
        const started = await engineOn().start({
          id: randomUUID(),
          options: options({ skills: skillsWithUserOnly(plugin) }),
          brief: { id: "brief", text: "Begin." },
        });
        session = started;
        const events = started.events[Symbol.asyncIterator]();
        await untilTurnEnds(events);
        const lastUserMessage = async (
          id: string,
          skill: string,
          input: string,
        ): Promise<unknown> => {
          started.send(
            { id, text: `/${skill} ${input}`.trim(), skillCommand: { skill, input } },
            "later",
          );
          const { turn } = await untilTurnEnds(events);
          expect(turn.consumedMessageIds).toEqual([id]);
          return lastRequestBody().messages.at(-1);
        };

        expect(await lastUserMessage("c-1", "office:release", "v2")).toEqual({
          role: "user",
          content: `Base directory for this skill: ${join(plugin, "skills", "release")}\n\nRelease v2 now.`,
        });
        expect(await lastUserMessage("c-2", "office:tdd", "")).toEqual({
          role: "user",
          content: `Base directory for this skill: ${join(plugin, "skills", "tdd")}\n\nWrite the test, then .`,
        });
        expect(await lastUserMessage("c-3", "ship", "to staging")).toEqual({
          role: "user",
          content: "Ship it.\n\nARGUMENTS: to staging",
        });
        expect(await lastUserMessage("c-4", "review", "the diff")).toEqual({
          role: "user",
          content: "/review the diff",
        });
      });
    });
  });

  describe("its conversation", () => {
    it("resumes an ended session from the conversation it kept, by its id", async () => {
      const id = randomUUID();
      fake.script(
        toolCall("Read", { file_path: join(folder, "missing.txt") }),
        textReply(["First."], USAGE),
      );
      const first = await engineOn().start({
        id,
        options: options(),
        brief: { id: "brief", text: "Begin." },
      });
      session = first;
      await untilTurnEnds(first.events[Symbol.asyncIterator]());
      await first.end();

      fake.script(textReply(["Second."], USAGE));
      const resumed = await engineOn().resume(id, options());
      session = resumed;
      resumed.send({ id: "again", text: "Again." }, "next");
      const { turn } = await untilTurnEnds(resumed.events[Symbol.asyncIterator]());

      expect(turn).toMatchObject({ outcome: "completed", consumedMessageIds: ["again"] });
      expect(lastRequestBody().messages.slice(1)).toMatchObject([
        { role: "user", content: "Begin." },
        { role: "assistant", tool_calls: [{ function: { name: "Read" } }] },
        { role: "tool" },
        { role: "assistant", content: "First." },
        { role: "user", content: "Again." },
      ]);
      expect(lastRequestBody().messages[0]).toMatchObject({ role: "system" });
    });

    it("keeps an answer for each call of a turn the session's end cut short", async () => {
      const id = randomUUID();
      fake.script(toolCall("mcp__office__hold", {}));
      const hold: OfficeTool = {
        name: "hold",
        description: "Holds.",
        input: z.object({}),
        run: () => new Promise(() => undefined),
      };
      const first = await engineOn().start({
        id,
        options: options({ officeTools: [hold] }),
        brief: { id: "brief", text: "Begin." },
      });
      const events = first.events[Symbol.asyncIterator]();
      let next = await events.next();
      while (!next.done && next.value.kind !== "tool-call") next = await events.next();
      await first.end();

      fake.script(textReply(["Back."], USAGE));
      const resumed = await engineOn().resume(id, options({ officeTools: [hold] }));
      session = resumed;
      resumed.send({ id: "again", text: "Again." }, "next");
      await untilTurnEnds(resumed.events[Symbol.asyncIterator]());

      expect(lastRequestBody().messages.slice(2)).toMatchObject([
        { role: "assistant" },
        { role: "tool", content: "Interrupted before it finished." },
        { role: "user", content: "[The user interrupted this turn.]\n\nAgain." },
      ]);
    });

    it("refuses to resume a session that kept no conversation", async () => {
      await expect(engineOn().resume(randomUUID(), options())).rejects.toThrow(ConversationMissing);
    });

    it("reads the context usage from the last request's tokens, against the model's window", async () => {
      fake.script(
        toolCall("Read", { file_path: join(folder, "missing.txt") }),
        textReply(["Done."], { prompt: 900, completion: 30, cached: 600 }),
      );

      await oneTurn();

      expect(await session?.readContextUsage()).toEqual({ tokens: 930, window: 100_000 });
    });

    it("estimates the context usage when the API endpoint counts no tokens", async () => {
      fake.script(textReply(["Done."]));

      await oneTurn();

      const usage = await session?.readContextUsage();
      expect(usage?.window).toBe(100_000);
      expect(usage?.tokens).toBeGreaterThan(100);
    });
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

    it("runs a command without the container runtime's variables", async () => {
      fake.script(
        toolCall("Bash", { command: 'echo "[$DOCKER_HOST$DOCKER_CONTEXT$CONTAINER_HOST]"' }),
        textReply(["Done."], USAGE),
      );
      const runtimeVariables = {
        DOCKER_HOST: "unix:///var/run/docker.sock",
        DOCKER_CONTEXT: "default",
        CONTAINER_HOST: "unix:///run/podman/podman.sock",
      };

      const { events } = await oneTurn(
        options({ profile: ANYTHING, environment: { ...environment, ...runtimeVariables } }),
      );

      expect(events.find((event) => event.kind === "tool-result")).toMatchObject({
        isError: false,
        text: "[]",
      });
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
      expect(messages.slice(-3).map((message) => message["role"])).toEqual([
        "assistant",
        "tool",
        "user",
      ]);
      // The interrupted turn's note and the next message, as one: a chat template may refuse two.
      expect(messages.at(-1)).toEqual({
        role: "user",
        content: "[The user interrupted this turn.]\n\nGo on.",
      });
    });
  });

  describe("its background commands", () => {
    const ANYTHING: PermissionProfile = { ...READ_ONLY, run: { kind: "anything" } };
    const environment = inheritedEnvironment();

    /** Starts a session whose first turn runs NODE_CHILD in the background after `echo started-42`. */
    async function startedInBackground(): Promise<{
      started: EngineSession;
      events: AsyncIterator<SessionEvent>;
      background: { id: string; outputFile: string };
      child: number;
      startedProcess: ProcessStartedEvent;
    }> {
      fake.script(
        toolCall("Bash", { command: `echo started-42; ${NODE_CHILD}`, run_in_background: true }),
        textReply(["Started."], USAGE),
      );
      const started = await engineOn().start({
        id: randomUUID(),
        options: options({ profile: ANYTHING, environment }),
        brief: { id: "brief", text: "Begin." },
      });
      session = started;
      const events = started.events[Symbol.asyncIterator]();
      const first = await untilTurnEnds(events);
      expect(first.turn.outcome).toBe("completed");
      const result = first.events.find((event) => event.kind === "tool-result");
      const answer =
        /^Command running in background with ID: (\S+)\. Output is being written to: (.+)$/.exec(
          result?.kind === "tool-result" ? result.text : "",
        );
      expect(answer).not.toBeNull();
      const [, id = "", outputFile = ""] = answer ?? [];
      const startedProcess = first.events.find(
        (event): event is ProcessStartedEvent => event.kind === "process-started",
      );
      const call = first.events.find((event) => event.kind === "tool-call");
      expect(startedProcess?.callId).toBe(call?.kind === "tool-call" ? call.callId : "");
      if (startedProcess === undefined) throw new Error("No Process start was reported.");
      return {
        started,
        events,
        background: { id, outputFile },
        child: await childProcessId(folder),
        startedProcess,
      };
    }

    it("runs past its turn, its output read by the session, until TaskStop ends it with what it started", async () => {
      const { started, events, background, child, startedProcess } = await startedInBackground();
      expect(startedProcess).toEqual({
        kind: "process-started",
        callId: startedProcess.callId,
        engineTaskId: background.id,
        withinToolCall: undefined,
        commandLine: `echo started-42; ${NODE_CHILD}`,
        description: `echo started-42; ${NODE_CHILD}`,
      });
      expect(isRunning(child)).toBe(true);
      await vi.waitFor(async () =>
        expect(await readFile(background.outputFile, "utf8")).toContain("started-42"),
      );

      fake.script(
        toolCall("Read", { file_path: background.outputFile }),
        toolCall("TaskStop", { task_id: background.id }),
        toolCall("TaskStop", { task_id: background.id }),
        textReply(["Stopped."], USAGE),
      );
      started.send({ id: "check", text: "Read it, then stop it." }, "later");
      const { events: seen } = await untilTurnEnds(events);

      expect(seen.filter((event) => event.kind === "tool-refused")).toEqual([]);
      expect(seen.filter((event) => event.kind === "tool-result")).toMatchObject([
        { isError: false, text: expect.stringContaining("started-42") },
        {
          isError: false,
          text: `Successfully stopped task: ${background.id} (echo started-42; ${NODE_CHILD})`,
        },
        { isError: true, text: expect.stringContaining(`Task ${background.id} is not running`) },
      ]);
      expect(isRunning(child)).toBe(false);
      const ended = seen.filter((event) => event.kind === "process-ended");
      expect(ended).toEqual([
        {
          kind: "process-ended",
          callId: startedProcess.callId,
          ending: { state: "stopped", by: "agent" },
          exitCode: undefined,
        },
      ]);
      // Reported before TaskStop answers, so the Process has ended once the Agent reads it has.
      const stopped = seen.findIndex(
        (event) => event.kind === "tool-result" && event.text.startsWith("Successfully stopped"),
      );
      expect(seen.indexOf(ended[0] as SessionEvent)).toBeLessThan(stopped);
    });

    it("tells the model of a task id it doesn't know", async () => {
      fake.script(toolCall("TaskStop", { task_id: "b0000" }), textReply(["Oh."], USAGE));

      const { events } = await oneTurn(options({ profile: ANYTHING, environment }));

      expect(events.find((event) => event.kind === "tool-result")).toMatchObject({
        isError: true,
        text: "No task found with ID: b0000",
      });
    });

    it("tells the model of one that ended by itself, as the next message would land", async () => {
      // The second call ends only once the first command's shell is gone: reaped, so the service
      // has seen its exit. The notice follows the end of its leftovers, at once on Linux once the
      // group is gone; on Windows that query starts before the second call's own, so ends first.
      fake.script(
        toolCall("Bash", {
          command: `${WRITE_SHELL_PID}; echo done-7; exit 3`,
          description: "Print and fail",
          run_in_background: true,
        }),
        toolCall("Bash", { command: UNTIL_SHELL_GONE }),
        textReply(["Seen."], USAGE),
      );

      const { events, turn } = await oneTurn(options({ profile: ANYTHING, environment }));

      expect(turn.outcome).toBe("completed");
      expect(turn.consumedMessageIds).toEqual(["brief"]);
      const started = events.find((event) => event.kind === "tool-result");
      const [, id = "", outputFile = ""] =
        /with ID: (\S+)\. Output is being written to: (.+)$/.exec(
          started?.kind === "tool-result" ? started.text : "",
        ) ?? [];
      const messages = lastRequestBody().messages;
      expect(messages.at(-1)).toEqual({
        role: "user",
        content: [
          "<task-notification>",
          `<task-id>${id}</task-id>`,
          `<output-file>${outputFile}</output-file>`,
          "<status>failed</status>",
          '<summary>Background command "Print and fail" failed with exit code 3</summary>',
          "</task-notification>",
        ].join("\n"),
      });
      expect(messages.at(-2)).toMatchObject({ role: "tool" });
      const seen = await withProcessEnded(events, session);
      const call = seen.find((event) => event.kind === "tool-call");
      const callId = call?.kind === "tool-call" ? call.callId : "";
      expect(outputOf(seen, callId)).toBe("done-7\n");
      expect(seen.find((event) => event.kind === "process-ended")).toEqual({
        kind: "process-ended",
        callId,
        ending: { state: "failed", reason: "Exited with code 3" },
        exitCode: 3,
      });
    });

    it("reports its output in order and whole, a character split between two reads included", async () => {
      fake.script(
        toolCall("Bash", { command: SPLIT_CHARACTER, run_in_background: true }),
        textReply(["Started."], USAGE),
      );

      const { events } = await oneTurn(options({ profile: ANYTHING, environment }));
      const seen = await withProcessEnded(events, session);

      const call = events.find((event) => event.kind === "tool-call");
      const callId = call?.kind === "tool-call" ? call.callId : "";
      const outputs = seen.filter((event) => event.kind === "process-output");
      // The first byte of "é" and the rest come in different reads, so in two events at least.
      expect(outputs.length).toBeGreaterThanOrEqual(2);
      expect(outputOf(seen, callId)).toBe("one\ncaf\u00e9\ntwo\n");
      expect(seen.find((event) => event.kind === "process-ended")).toMatchObject({
        callId,
        ending: { state: "finished" },
        exitCode: 0,
      });
      expect(seen.findIndex((event) => event.kind === "process-ended")).toBeGreaterThan(
        seen.findLastIndex((event) => event.kind === "process-output"),
      );
    });

    it("ends every one with what it started on interrupt, between turns too", async () => {
      const { started, child } = await startedInBackground();
      expect(isRunning(child)).toBe(true);

      await started.interrupt();

      expect(isRunning(child)).toBe(false);
      expect((await withProcessEnded([], started)).at(-1)).toMatchObject({
        kind: "process-ended",
        ending: { state: "stopped", by: "interrupt" },
      });
    });

    it("ends every one with what it started when the session ends, and removes their output", async () => {
      const { started, events, background, child, startedProcess } = await startedInBackground();

      await started.end();
      session = undefined;

      expect(isRunning(child)).toBe(false);
      await expect(readFile(background.outputFile)).rejects.toThrow("ENOENT");
      // Its end is told before the session's events end, its output read to the last.
      const rest: SessionEvent[] = [];
      for (let next = await events.next(); next.done !== true; next = await events.next()) {
        rest.push(next.value);
      }
      expect(rest.at(-1)).toEqual({
        kind: "process-ended",
        callId: startedProcess.callId,
        ending: { state: "stopped", by: "session-end" },
        exitCode: undefined,
      });
    });
  });

  describe("its web tools", () => {
    const WEB: PermissionProfile = { ...READ_ONLY, web: true };
    let searxng: FakeSearxngServer;

    beforeAll(async () => {
      searxng = await FakeSearxngServer.start();
    });

    afterAll(async () => {
      await searxng.close();
    });

    it("searches through the search endpoint Settings › Engines sets", async () => {
      searxng.results("office", [{ title: "Office", url: "https://example.com/", snippet: "" }]);
      fake.script(toolCall("WebSearch", { query: "office" }), textReply(["Found."], USAGE));

      const { events } = await oneTurn(
        options({ profile: WEB }),
        engineOn([endpoint()], { baseUrl: searxng.baseUrl }),
      );

      expect(events.filter((event) => event.kind === "tool-refused")).toEqual([]);
      expect(events.find((event) => event.kind === "tool-result")).toMatchObject({
        isError: false,
        text: expect.stringContaining("1. [Office](https://example.com/)"),
      });
    });

    it("leaves the profile's refusal first, then refuses a search with no search endpoint", async () => {
      fake.script(
        toolCall("WebSearch", { query: "office" }),
        toolCall("WebFetch", { url: "https://example.com/", prompt: "?" }),
        textReply(["No."], USAGE),
      );
      const { events: underReadOnly } = await oneTurn();
      await session?.end();
      fake.script(toolCall("WebSearch", { query: "office" }), textReply(["No."], USAGE));
      const { events: withWeb } = await oneTurn(options({ profile: WEB }));

      expect(underReadOnly.filter((event) => event.kind === "tool-refused")).toMatchObject([
        { tool: "WebSearch", refusedBy: "office-rules" },
        { tool: "WebFetch", refusedBy: "office-rules" },
      ]);
      expect(withWeb.filter((event) => event.kind === "tool-refused")).toEqual([
        {
          kind: "tool-refused",
          callId: expect.any(String),
          tool: "WebSearch",
          refusedBy: "engine",
          reason:
            "WebSearch has no search endpoint: none is set in Settings › Engines, so nothing was searched.",
        },
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
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    const streaming = fake.requests.at(-1);

    await started.interrupt();
    const { events: reported, turn } = await untilTurnEnds(events);
    started.send({ id: "after", text: "Go on." }, "next");
    await untilTurnEnds(events);

    expect(turn.outcome).toBe("interrupted");
    expect(reported.filter((event) => event.kind === "text")).toEqual([]);
    expect(await streaming?.ended).toBe("closed-by-client");
    expect(lastRequestBody().messages.slice(1)).toEqual([
      { role: "user", content: "Begin.\n\n[The user interrupted this turn.]\n\nGo on." },
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

  describe("its MCP servers", () => {
    const ECHO_TOOL = {
      name: "echo",
      description: "Answers with the text it is given.",
      inputSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: { text: { type: "string" } },
      },
    };
    const ECHO_ALLOWED: PermissionProfile = {
      ...READ_ONLY,
      mcpTools: { "fake/echo": { kind: "allowed" } },
    };

    it("offers each server's tools as recorded, under mcp__<server>__<tool>, and runs an allowed call", async () => {
      fake.script(toolCall("mcp__fake__echo", { text: "hi" }), textReply(["Done."], USAGE));

      const { events } = await oneTurn(
        options({
          profile: ECHO_ALLOWED,
          mcpServers: [
            { name: "fake", launch: CONTRACT_MCP_SERVER.launch({}, folder), tools: [ECHO_TOOL] },
          ],
        }),
      );

      expect(events.find((event) => event.kind === "tool-result")).toMatchObject({
        text: "hi",
        isError: false,
      });
      const offered = lastRequestBody().tools.at(-1);
      expect(offered?.function).toEqual({
        name: "mcp__fake__echo",
        description: ECHO_TOOL.description,
        parameters: { type: "object", properties: { text: { type: "string" } } },
      });
    });

    it("reports a server that fails to start once and keeps it in the tool list, a call answering why, both without its Server values", async () => {
      const secret = "plum-secret-value";
      const failing = {
        transport: "stdio",
        command: process.execPath,
        arguments: ["-e", "console.error('token ' + process.env.FAKE_TOKEN); process.exit(1)"],
        environmentVariables: { FAKE_TOKEN: secret },
        workingFolder: folder,
      } as const;
      fake.script(toolCall("mcp__fake__echo", { text: "hi" }), textReply(["Done."], USAGE));
      const id = randomUUID();
      const started = await engineOn().start({
        id,
        options: options({
          profile: ECHO_ALLOWED,
          mcpServers: [{ name: "fake", launch: failing, tools: [ECHO_TOOL] }],
        }),
        brief: { id: "brief", text: "Begin." },
      });
      session = started;

      const { events } = await untilTurnEnds(started.events[Symbol.asyncIterator]());

      // The call tried the server again; only its start at the session's opening is reported.
      expect(events.filter((event) => event.kind === "mcp-server-not-started")).toEqual([
        {
          kind: "mcp-server-not-started",
          server: "fake",
          reason: expect.stringContaining("token [a Server value]"),
        },
      ]);
      expect(events[0]?.kind).toBe("mcp-server-not-started");
      expect(lastRequestBody().tools.at(-1)?.function.name).toBe("mcp__fake__echo");
      const result = events.find((event) => event.kind === "tool-result");
      expect(result).toMatchObject({
        isError: true,
        text: expect.stringContaining("token [a Server value]"),
      });
      expect(JSON.stringify(events)).not.toContain(secret);
      // Kept once the turn has ended, as the session saves it after its turn.
      const kept = await vi.waitFor(() =>
        readFile(join(officeData, "sessions", id, "conversation.json"), "utf8"),
      );
      expect(kept).toContain("token [a Server value]");
      expect(kept).not.toContain(secret);
    });
  });
});

/**
 * Writes the id of the shell running it to `shell.pid`, for `UNTIL_SHELL_GONE`. The rename makes the
 * file appear whole, so a reader never sees it empty.
 */
const WRITE_SHELL_PID = `node -e "const fs = require('fs'); fs.writeFileSync('shell.pid.part', String(process.ppid)); fs.renameSync('shell.pid.part', 'shell.pid')"`;
/**
 * Waits, as long as it takes, until `shell.pid` is written and the shell it names is gone: the
 * background command may not have written it yet when this starts. Before its parent reaps it, an
 * ended process still answers signal 0, so gone means the service has seen its exit.
 */
const UNTIL_SHELL_GONE = `node -e "const fs = require('fs'); const gone = () => { if (fs.existsSync('shell.pid') === false) return false; try { process.kill(Number(fs.readFileSync('shell.pid', 'utf8')), 0); return false; } catch { return true; } }; const check = () => gone() || setTimeout(check, 10); check()"`;
/** Prints a line, then "café" with its "é" split between writes a second apart, then a line. */
const SPLIT_CHARACTER = `node -e "process.stdout.write(Buffer.from([0x6f, 0x6e, 0x65, 0x0a, 0x63, 0x61, 0x66, 0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa9, 0x0a, 0x74, 0x77, 0x6f, 0x0a])), 1200)"`;

/** The events up to a Process's end: those seen so far, then the session's next ones. */
async function withProcessEnded(
  seen: readonly SessionEvent[],
  from: EngineSession | undefined,
): Promise<SessionEvent[]> {
  const all = [...seen];
  const events = from?.events[Symbol.asyncIterator]();
  while (!all.some((event) => event.kind === "process-ended")) {
    const next = await events?.next();
    if (next === undefined || next.done === true) {
      throw new Error("The session ended before its Process did.");
    }
    all.push(next.value);
  }
  return all;
}

/** What a Process wrote, joined from its output events. */
function skillsWithUserOnly(plugin: string): SessionSkills {
  return {
    folder: plugin,
    names: ["office:release", "office:tdd", "lint-all", "ops:deploy", "ship"],
    expected: ["lint", "office:tdd", "ops:deploy"],
    userOnly: ["office:release", "ship"],
    overrides: {},
  };
}

function outputOf(events: readonly SessionEvent[], callId: string): string {
  return events
    .flatMap((event) =>
      event.kind === "process-output" && event.callId === callId ? [event.text] : [],
    )
    .join("");
}

/** A command whose node child writes its id where `childProcessId` finds it, then runs on. */
const NODE_CHILD = `node -e "require('fs').writeFileSync('child.pid', String(process.pid)); setInterval(() => {}, 1000)"`;

async function childProcessId(folder: string): Promise<number> {
  for (;;) {
    const text = await readFile(join(folder, "child.pid"), "utf8").catch(() => "");
    if (text !== "") return Number(text);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function writeTextFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
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
  readonly tools: readonly {
    readonly function: { readonly name: string; readonly description: string };
  }[];
}

function lastRequestBody(): RecordedBody {
  return fake.requests.at(-1)?.body as RecordedBody;
}
