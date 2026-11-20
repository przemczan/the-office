import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import type { GeminiSession, GeminiTurn } from "../../gemini/gemini-session.ts";
import {
  SKILL_TOOL,
  STRUCTURED_OUTPUT_TOOL,
  type OfficeTool,
  type OutputSchema,
} from "../../gemini/office-server.ts";
import { mcpToolName, OFFICE_SERVER } from "../../gemini/options.ts";
import { pinnedCliEntry } from "../../gemini/pinned-cli.ts";
import { processesNaming } from "../../gemini/process-trees.ts";
import {
  PROJECT_SECRET_VARIABLE,
  PROJECT_SERVER,
  PROJECT_SERVER_TOOL,
} from "../../gemini/project-mcp-server.ts";
import type { Json } from "../../json.ts";
import { processRunning } from "../observations.ts";
import {
  anyFileHolds,
  cliFlags,
  hookSaw,
  sortedUnique,
  startIn,
  turnOutcome,
  wait,
} from "./helpers.ts";

const CODE_WORD_TOOL = "get_code_word";
const OFFICE_WORD = "LANTERN-64";

/**
 * Office tools (spec §5.4 Office actions) through the service's relay, a stdio MCP server the CLI
 * starts as its child: the model calls one, its answer reaches the model, the relay runs while it
 * answers, and none is left once the turn's process has ended.
 */
export const geminiOfficeToolCheck: Check = {
  id: "gemini.office-tool",
  title: "an Office tool served through the relay is called and answers",
  async run(context) {
    let session: GeminiSession | undefined;
    let relaysDuringCall = 0;
    const tool: OfficeTool = {
      name: CODE_WORD_TOOL,
      description: "Answers the Office's code word.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        if (session !== undefined) {
          relaysDuringCall = (await processesNaming(session.channelFile)).length;
        }
        return { text: OFFICE_WORD };
      },
    };
    session = (await startIn(context, { officeTools: [tool] })).session;
    const turn = await session.prompt(
      `Call ${mcpToolName(OFFICE_SERVER, CODE_WORD_TOOL)} once, then reply with just the word it answers.`,
    );
    return {
      ...turnOutcome(turn),
      officeToolCalls: session.officeToolCalls.length,
      answerReachedModel: turn.reply.includes(OFFICE_WORD),
      relaysRunningDuringCall: relaysDuringCall > 0,
      relaysLeftAfterTurn: (await processesNaming(session.channelFile)).length,
    };
  },
};

const SECRET = "secret-value-5b1f0c";

/**
 * A Role's MCP server (spec §5.4 MCP servers) as the adapter runs one: the service starts it over
 * stdio with its secret value in its own environment, and the CLI reaches its tools through the
 * relay. Its call is judged first; the value is in no environment of the CLI, on no command line and
 * in no file left; its process ends with the session.
 */
export const geminiMcpToolCheck: Check = {
  id: "gemini.mcp-tool",
  title:
    "a Role's MCP server's tool is judged, called through the relay, and its secret stays with it",
  async run(context) {
    const log = join(context.sandbox.root, "project-server.jsonl");
    const { session, repository } = await startIn(context, {
      projectMcpServers: {
        [PROJECT_SERVER]: {
          command: process.execPath,
          args: [join(import.meta.dirname, "..", "..", "gemini", "project-mcp-stdio.ts"), log],
          env: { [PROJECT_SECRET_VARIABLE]: SECRET },
        },
      },
    });
    const turn = await session.prompt(
      `Call ${mcpToolName(PROJECT_SERVER, PROJECT_SERVER_TOOL)} once, then reply with just its answer.`,
    );
    await session.close();
    const entries = (await readFile(log, "utf8").catch(() => ""))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { pid?: number; argv?: string[]; secretSet?: boolean });
    const pids = entries.flatMap((entry) => (entry.pid === undefined ? [] : [entry.pid]));
    return {
      ...turnOutcome(turn),
      judged: hookSaw(session),
      called: entries.some((entry) => entry.secretSet !== undefined),
      secretArrived: entries.some((entry) => entry.secretSet === true),
      secretInCliEnvironment: Object.values(session.environment).some((value) =>
        value.includes(SECRET),
      ),
      secretOnCommandLine: entries.some((entry) => (entry.argv ?? []).join(" ").includes(SECRET)),
      secretInFilesLeft:
        (await anyFileHolds(context.sandbox.officeData, SECRET)) ||
        (await anyFileHolds(repository, SECRET)),
      processEnded: await allEnded(pids),
    };
  },
};

const SESSION_SKILL = "office-check";
const REPOSITORY_SKILL = "repository-check";
const SESSION_SKILL_WORD = "SKILL-WORD-19";
const REPOSITORY_SKILL_WORD = "SKILL-WORD-27";

function skill(name: string, word: string): string {
  return `---\nname: ${name}\ndescription: Says the ${name} code word.\n---\n\nReply with the code word ${word}.\n`;
}

/**
 * Skills (spec §5.6) as the adapter gives them: the session's through the Office server's Skill
 * tool, the CLI's own skill loading off, so a skill in the repository's `.gemini/skills/` doesn't
 * load and `activate_skill` isn't offered.
 */
export const geminiSkillsCheck: Check = {
  id: "gemini.skills",
  title: "the session's skills load through the Skill tool, and the repository's don't",
  async run(context) {
    const repository = await context.sandbox.createRepository("repository-skills");
    const repositorySkill = join(repository, ".gemini", "skills", REPOSITORY_SKILL);
    await mkdir(repositorySkill, { recursive: true });
    await writeFile(
      join(repositorySkill, "SKILL.md"),
      skill(REPOSITORY_SKILL, REPOSITORY_SKILL_WORD),
    );
    const session = await context.startGeminiSession({
      repository,
      skills: { [SESSION_SKILL]: skill(SESSION_SKILL, SESSION_SKILL_WORD) },
    });
    const sessionTurn = await session.prompt(
      `Load the skill ${SESSION_SKILL} with ${mcpToolName(OFFICE_SERVER, SKILL_TOOL)} and do what it says.`,
    );
    const repositoryTurn = await session.prompt(
      `If a skill named ${REPOSITORY_SKILL} is available to you, load it and do what it says; otherwise reply with just NONE.`,
    );
    return {
      sessionSkill: {
        ...turnOutcome(sessionTurn),
        loadedBySkillTool: loadedAsSkill(session, SESSION_SKILL),
        bodyReachedModel: sessionTurn.reply.includes(SESSION_SKILL_WORD),
      },
      // The model may still read the repository's SKILL.md as a file; only loading it as a skill counts.
      repositorySkill: {
        ...turnOutcome(repositoryTurn),
        loadedAsSkill: loadedAsSkill(session, REPOSITORY_SKILL),
      },
      activateSkillCalled: session.toolCalls.some((call) => call.name === "activate_skill"),
    };
  },
};

/** Whether a Skill (or `activate_skill`) call for the skill completed. */
function loadedAsSkill(session: GeminiSession, skillName: string): boolean {
  return session.toolCalls.some(
    (call) =>
      (call.name === mcpToolName(OFFICE_SERVER, SKILL_TOOL) || call.name === "activate_skill") &&
      call.status === "completed" &&
      JSON.stringify(call.input).includes(skillName),
  );
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    fileCount: { type: "integer" },
  },
  required: ["verdict", "fileCount"],
  additionalProperties: false,
} as const;

/** As the adapter's `OUTPUT_REMINDERS`: how often a turn that ended without its output is reminded. */
const OUTPUT_REMINDERS = 2;

/**
 * Answers held to a schema (spec §5.4 `outputSchema`) as the adapter holds them: no schema flag, so
 * a StructuredOutput tool on the Office server whose input schema is the answer's, checked as it
 * arrives, and a reminder in a resumed turn while a turn ends without it.
 */
export const geminiOutputSchemaCheck: Check = {
  id: "gemini.output-schema",
  title: "an answer held to a schema through StructuredOutput",
  async run(context) {
    const flags = await cliFlags(join(context.sandbox.root, "help-home"));
    const outputSchema: OutputSchema = {
      schema: OUTPUT_SCHEMA as unknown as Json,
      check: (input) =>
        matchesOutputSchema(input)
          ? undefined
          : "The answer doesn't fit the schema; call the tool again with an answer that does.",
    };
    const { session } = await startIn(context, { outputSchema });
    const structuredOutput = mcpToolName(OFFICE_SERVER, STRUCTURED_OUTPUT_TOOL);
    let turn: GeminiTurn = await session.prompt(
      `Count the files in the repository's top folder with list_directory, then give your answer: verdict "pass" and the count.`,
    );
    let reminders = 0;
    while (
      turn.stopReason === "end_turn" &&
      session.officeServer.outputs.length === 0 &&
      reminders < OUTPUT_REMINDERS
    ) {
      reminders += 1;
      turn = await session.prompt(
        `Your turn isn't over: call the ${structuredOutput} tool with your answer, in the shape its input asks for.`,
      );
    }
    const inputs = session.officeToolCalls
      .filter((call) => call.name === STRUCTURED_OUTPUT_TOOL)
      .map((call) => call.input);
    return {
      schemaFlags: flags.filter((flag) => /schema/.test(flag)),
      ...turnOutcome(turn),
      structuredOutputCalls: inputs.length,
      outputTaken: session.officeServer.outputs.length > 0,
      remindersNeeded: reminders,
      lastAnswerMatchesSchema: inputs.length > 0 && matchesOutputSchema(inputs.at(-1) ?? null),
    };
  },
};

function matchesOutputSchema(input: Json): boolean {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  return (
    Object.keys(input).toSorted().join(",") === "fileCount,verdict" &&
    (input["verdict"] === "pass" || input["verdict"] === "fail") &&
    Number.isInteger(input["fileCount"])
  );
}

/**
 * Where a turn's tokens and the context's size show (spec §5.4 `contextUsage`): the `result`
 * event's stats, and the chat the CLI keeps in the engine folder, which the adapter reads the
 * latest answer's prompt and output tokens from (`gemini-context-usage.ts`).
 */
export const geminiContextUsageCheck: Check = {
  id: "gemini.context-usage",
  title: "a turn's tokens, and the latest answer's tokens in the chat the CLI keeps",
  async run(context) {
    const { session } = await startIn(context);
    const turn = await session.prompt("Reply with just OK.");
    const result = session.events.find(
      (event) => (event as { type?: string } | null)?.type === "result",
    ) as { stats?: Record<string, Json> } | undefined;
    return {
      ...turnOutcome(turn),
      turnTokens: turn.usage !== undefined && turn.usage.input + turn.usage.cacheRead > 0,
      resultStatsKeys: sortedUnique(Object.keys(result?.stats ?? {})),
      quotaInStream: session.events.some((event) =>
        /quota|rate.?limit|remaining/i.test(JSON.stringify(event)),
      ),
      chatRecordsTokens:
        (await recordedAnswerTokens(session.home, session.sessionId)) !== undefined,
    };
  },
};

/**
 * The latest model answer's tokens in the session's chat (`<home>/.gemini/tmp/<project>/chats/
 * session-<time>-<first 8 of the id>.jsonl`), as the adapter's `recordedContextTokens` reads them.
 */
async function recordedAnswerTokens(home: string, sessionId: string): Promise<number | undefined> {
  const tmp = join(home, ".gemini", "tmp");
  for (const project of await readdir(tmp).catch(() => [])) {
    const chats = join(tmp, project, "chats");
    const files = (await readdir(chats).catch(() => [])).filter(
      (name) => name.startsWith("session-") && name.endsWith(`-${sessionId.slice(0, 8)}.jsonl`),
    );
    for (const file of files) {
      const records = (await readFile(join(chats, file), "utf8"))
        .split("\n")
        .flatMap((line) => parsedRecord(line));
      if (records[0]?.["sessionId"] !== sessionId) continue;
      const tokens = records.findLast(
        (record) => record["type"] === "gemini" && typeof record["tokens"] === "object",
      )?.["tokens"] as { input?: number; output?: number } | undefined;
      if (tokens !== undefined) return (tokens.input ?? 0) + (tokens.output ?? 0);
    }
  }
  return undefined;
}

function parsedRecord(line: string): Record<string, unknown>[] {
  if (line.trim() === "") return [];
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? [parsed as Record<string, unknown>]
      : [];
  } catch {
    return [];
  }
}

/** Whether the pinned CLI has a language-server tool (spec §5.4 `languageServers`): its tool reference names none. */
export const geminiLanguageServersCheck: Check = {
  id: "gemini.language-servers",
  title: "the CLI offers no language-server tool",
  async run() {
    const reference = await readFile(
      join(pinnedCliEntry(), "..", "docs", "reference", "tools.md"),
      "utf8",
    );
    return {
      toolReferenceNamesLanguageServer: /language server|\blsp\b/i.test(reference),
    };
  },
};

async function allEnded(pids: readonly number[]): Promise<boolean> {
  await wait(1000);
  return pids.every((pid) => !processRunning(pid));
}
