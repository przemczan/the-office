import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check, Observation } from "../../check.ts";
import { GeminiAcpSession } from "../../gemini/acp-session.ts";
import type { GeminiSession } from "../../gemini/gemini-session.ts";
import type { OfficeTool } from "../../gemini/office-channel.ts";
import { mcpToolName, OFFICE_SERVER } from "../../gemini/options.ts";
import { pinnedCliEntry } from "../../gemini/pinned-cli.ts";
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
  onBothTransports,
  sortedUnique,
  startIn,
  turnOutcome,
} from "./helpers.ts";

const CODE_WORD_TOOL = "get_code_word";
const OFFICE_WORD = "LANTERN-64";

/**
 * Office tools (spec §5.4 Office actions) from the session's stdio MCP server, the one route the
 * check offers them on: the model calls one, its answer reaches the model, and the server's process
 * ends with the session.
 */
export const geminiOfficeToolsCheck: Check = {
  id: "gemini.office-tools",
  title: "an Office tool served over stdio MCP is called and answers",
  async run(context) {
    return onBothTransports(async (transport) => {
      const tool: OfficeTool = {
        name: CODE_WORD_TOOL,
        description: "Answers the Office's code word.",
        inputSchema: { type: "object", properties: {} },
        run: async () => ({ text: OFFICE_WORD }),
      };
      const { session } = await startIn(context, transport, { officeTools: [tool] });
      const turn = await session.prompt(
        `Call ${mcpToolName(OFFICE_SERVER, CODE_WORD_TOOL)} once, then reply with just the word it answers.`,
      );
      const processes = await session.mcpProcesses();
      await session.close();
      return {
        ...turnOutcome(turn),
        officeToolCalls: session.officeToolCalls.length,
        answerReachedModel: turn.reply.includes(OFFICE_WORD),
        serverStartedAsChild: processes.length > 0,
        serverEndedWithSession: await allEnded(processes.map((entry) => entry.pid)),
      };
    });
  },
};

const REVIEW_TOOL = "ask_for_review";

/**
 * Barge-in while an Office tool answers, as `fallback.priority-next-office-tool` (the case that broke
 * over a `localhost` MCP endpoint on Windows): the tool's handler sends a second `session/prompt`
 * before it answers. ACP only, as headless takes no input during a turn.
 */
export const geminiOfficeToolBargeInCheck: Check = {
  id: "gemini.office-tool-barge-in",
  title: "a message sent while an Office tool answers",
  async run(context) {
    let session: GeminiSession | undefined;
    let second: ReturnType<GeminiSession["prompt"]> | undefined;
    const review: OfficeTool = {
      name: REVIEW_TOOL,
      description: "Asks the user to review the work so far.",
      inputSchema: { type: "object", properties: { summary: { type: "string" } } },
      run: async () => {
        second = session?.prompt("A note from the user: nothing changes. Reply with just NOTED.");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { text: "Reviewed." };
      },
    };
    session = (await startIn(context, "acp", { officeTools: [review] })).session;
    const first = await session.prompt(
      `Call ${mcpToolName(OFFICE_SERVER, REVIEW_TOOL)} once, then reply with just OK.`,
    );
    const secondTurn = second === undefined ? undefined : await second;
    return {
      officeToolCalls: session.officeToolCalls.length,
      firstTurn: turnOutcome(first),
      secondTurn: secondTurn === undefined ? null : turnOutcome(secondTurn),
      noteAnswered: secondTurn?.reply.includes("NOTED") ?? false,
    };
  },
};

const STRUCTURED_OUTPUT = "StructuredOutput";
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    fileCount: { type: "integer" },
  },
  required: ["verdict", "fileCount"],
  additionalProperties: false,
} as const;

/**
 * Answers held to a schema (spec §5.4 `outputSchema`): whether the CLI has a flag for one, and the
 * route the OpenAI-compatible engine takes, a `StructuredOutput` Office tool whose input schema is the
 * answer's, checked against the schema when it arrives.
 */
export const geminiOutputSchemaCheck: Check = {
  id: "gemini.output-schema",
  title: "an answer held to a schema through a StructuredOutput Office tool",
  async run(context) {
    const flags = await cliFlags(join(context.sandbox.root, "help-home"));
    const observations = await onBothTransports(async (transport) => {
      const inputs: Json[] = [];
      const structuredOutput: OfficeTool = {
        name: STRUCTURED_OUTPUT,
        description: "Gives your final answer. Call it exactly once, as your last action.",
        inputSchema: OUTPUT_SCHEMA as unknown as Json,
        run: async (input) => {
          inputs.push(input);
          return matchesOutputSchema(input)
            ? { text: "Answer received." }
            : { text: "The answer doesn't match the schema; call the tool again.", isError: true };
        },
      };
      const { session } = await startIn(context, transport, { officeTools: [structuredOutput] });
      const turn = await session.prompt(
        `Count the files in the repository's top folder with list_directory, then give your answer with ${mcpToolName(OFFICE_SERVER, STRUCTURED_OUTPUT)}: verdict "pass" and the count.`,
      );
      return {
        ...turnOutcome(turn),
        structuredOutputCalls: inputs.length,
        lastAnswerMatchesSchema: inputs.length > 0 && matchesOutputSchema(inputs.at(-1) ?? null),
      };
    });
    return {
      schemaFlags: flags.filter((flag) => /schema/.test(flag)),
      ...observations,
    };
  },
};

function matchesOutputSchema(input: Json): boolean {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const keys = Object.keys(input).toSorted();
  return (
    keys.join(",") === "fileCount,verdict" &&
    (input["verdict"] === "pass" || input["verdict"] === "fail") &&
    Number.isInteger(input["fileCount"])
  );
}

const SESSION_SKILL = "office-check";
const WORKSPACE_SKILL = "repository-check";
const SESSION_SKILL_WORD = "SKILL-WORD-19";
const WORKSPACE_SKILL_WORD = "SKILL-WORD-27";

function skill(name: string, word: string): string {
  return `---\nname: ${name}\ndescription: Says the ${name} code word.\n---\n\nReply with the code word ${word}.\n`;
}

/**
 * Skills (spec §5.6): a skill in the session's home (`<home>/.gemini/skills/`, where The Office
 * would write the session's skills) and one in the repository's `.gemini/skills/`; which the model
 * can activate with `activate_skill`, and whether the skill's body reaches it.
 */
export const geminiSkillsCheck: Check = {
  id: "gemini.skills",
  title: "the session's skills load from its home, and which others load beside them",
  async run(context) {
    return onBothTransports(async (transport) => {
      const repository = await context.sandbox.createRepository(`repository-${transport}`);
      const workspaceSkill = join(repository, ".gemini", "skills", WORKSPACE_SKILL);
      await mkdir(workspaceSkill, { recursive: true });
      await writeFile(
        join(workspaceSkill, "SKILL.md"),
        skill(WORKSPACE_SKILL, WORKSPACE_SKILL_WORD),
      );
      const session = await context.startGeminiSession({
        transport,
        repository,
        skills: { [SESSION_SKILL]: skill(SESSION_SKILL, SESSION_SKILL_WORD) },
      });
      const sessionTurn = await session.prompt(
        `Activate the skill ${SESSION_SKILL} with activate_skill and do what it says.`,
      );
      const workspaceTurn = await session.prompt(
        `Activate the skill ${WORKSPACE_SKILL} with activate_skill and do what it says.`,
      );
      return {
        sessionSkill: {
          ...turnOutcome(sessionTurn),
          bodyReachedModel: sessionTurn.reply.includes(SESSION_SKILL_WORD),
        },
        workspaceSkill: {
          ...turnOutcome(workspaceTurn),
          bodyReachedModel: workspaceTurn.reply.includes(WORKSPACE_SKILL_WORD),
        },
        activations: session.toolCalls
          .filter((call) => call.name === "activate_skill")
          .map((call) => call.status),
      };
    });
  },
};

const SECRET = "secret-value-5b1f0c";

/**
 * The Office's MCP servers (spec §5.4 MCP servers): a Project's stdio server with a secret value in
 * its environment, handed over without a file (ACP in `session/new`, headless as `$NAME` in the
 * settings, expanded from the CLI's environment). The value stays off every command line and out of
 * the files left behind, its process ends with the session, and its call is judged first.
 */
export const geminiMcpServersCheck: Check = {
  id: "gemini.mcp-servers",
  title: "a Project MCP server over stdio gets its secret without a file and ends with the session",
  async run(context) {
    return onBothTransports(async (transport) => {
      const log = join(context.sandbox.root, `project-server-${transport}.jsonl`);
      const { session, repository } = await startIn(context, transport, {
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
        called: entries.some((entry) => entry.secretSet !== undefined),
        secretArrived: entries.some((entry) => entry.secretSet === true),
        secretOnCommandLine: entries.some((entry) => (entry.argv ?? []).join(" ").includes(SECRET)),
        secretInFilesLeft:
          (await anyFileHolds(session.home, SECRET)) || (await anyFileHolds(repository, SECRET)),
        processEnded: await allEnded(pids),
        judged: sortedUnique([
          ...session.hookCalls.map((call) => call.input.tool_name),
          ...session.permissionRequests.flatMap((request) => request.mcp?.tool_name ?? []),
        ]),
      };
    });
  },
};

/** Where per-turn tokens and the context's size show (spec §5.4 `contextUsage`). */
export const geminiContextUsageCheck: Check = {
  id: "gemini.context-usage",
  title: "a turn's tokens and the context's size are reported",
  async run(context) {
    return onBothTransports(async (transport) => {
      const { session } = await startIn(context, transport);
      const turn = await session.prompt("Reply with just OK.");
      return {
        ...turnOutcome(turn),
        turnTokens: turn.usage !== undefined && turn.usage.input + turn.usage.cacheRead > 0,
        ...(session instanceof GeminiAcpSession
          ? {
              usageUpdates: session.contextUsage.length > 0,
              contextSizeGiven: session.contextUsage.some((usage) => usage.size > 0),
            }
          : {}),
      };
    });
  },
};

/**
 * Quota readings (spec §5.4 `usageWindows`): what a turn's output says about quota, on either
 * transport, without The Office using the CLI's OAuth token itself. ACP's `_meta.quota` is read for
 * its keys; headless the `result` event's `stats` keys.
 */
export const geminiUsageWindowsCheck: Check = {
  id: "gemini.usage-windows",
  title: "what the CLI tells about quota after a turn",
  async run(context) {
    return onBothTransports(async (transport): Promise<Observation> => {
      const { session } = await startIn(context, transport);
      await session.prompt("Reply with just OK.");
      if (session instanceof GeminiAcpSession) {
        const quota = session.lastPromptMeta?.["quota"];
        return {
          promptResponseQuotaKeys: sortedUnique(
            quota !== null && typeof quota === "object" && !Array.isArray(quota)
              ? Object.keys(quota)
              : [],
          ),
          quotaInUpdates: session.events.some(namesQuota),
        };
      }
      const result = session.events.find(
        (event) => (event as { type?: string } | null)?.type === "result",
      ) as { stats?: Record<string, Json> } | undefined;
      return {
        resultStatsKeys: sortedUnique(Object.keys(result?.stats ?? {})),
        quotaInStream: session.events.some(namesQuota),
      };
    });
  },
};

function namesQuota(event: Json): boolean {
  return /quota|rate.?limit|remaining/i.test(JSON.stringify(event));
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
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return pids.every((pid) => !processRunning(pid));
}
