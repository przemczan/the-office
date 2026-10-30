import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import { TOKEN_VARIABLE } from "../../claude-code-p/arguments.ts";
import { officeToolName } from "../../office-options.ts";
import { SESSION_PLUGIN_NAME } from "../../sandbox.ts";
import { observeCall } from "../permissions/call-observations.ts";
import { toolDecision } from "../permissions/hook-decisions.ts";
import { sortedNames } from "../observations.ts";
import { skill } from "../skills/fixtures.ts";
import { toolCalls, toolResultText, type ToolCall } from "../tool-calls.ts";
import { HANDOVER_NOTE, handoverNoteTool } from "./office-tools.ts";
import { requestsToHost } from "./observations.ts";

const SESSION_SKILL = skill("alpha");
const NOTE = "check";
/** Writes whether the session's token reached the Agent's commands, never the token itself. */
const TOKEN_SCRIPT = "token-check.mjs";
const TOKEN_REPORT = "token-check.txt";
const ALLOWED_COMMAND = `node ${TOKEN_SCRIPT}`;
const REFUSED_COMMAND = "git log --oneline";
const REFUSAL = "The Office rules refuse this command.";

const PROMPT =
  `Make these tool calls one at a time, waiting for each result, and do not retry a refused call: ` +
  `1. Call the ${HANDOVER_NOTE} tool with the note "${NOTE}". ` +
  `2. Run \`${ALLOWED_COMMAND}\` with the Bash tool. ` +
  `3. Run \`${REFUSED_COMMAND}\` with the Bash tool. ` +
  `4. Run the ${SESSION_PLUGIN_NAME}:${SESSION_SKILL.name} skill with the Skill tool. ` +
  `Then reply with just OK.`;

/**
 * The Office tools and the Office rules (spec §5.4 Defaults, §6): an Office tool through the
 * binary's stream, a hook endpoint that allows one command and refuses another, and a session skill
 * run by the `Skill(office:…)` rule ticket 22 names, all in one turn.
 */
export const fallbackToolsAndRulesCheck: Check = {
  id: "fallback.tools-and-rules",
  title:
    "an Office tool through the stream runs, the hook endpoint refuses a call, and a session skill runs",
  async run({ sandbox, startClaudeCodePSession }) {
    const repository = await sandbox.createRepository();
    await writeFile(
      join(repository, TOKEN_SCRIPT),
      `import { writeFileSync } from "node:fs";\n` +
        `writeFileSync("${TOKEN_REPORT}", process.env.${TOKEN_VARIABLE} === undefined ? "absent" : "present");\n`,
    );
    const notes: string[] = [];
    const session = await startClaudeCodePSession({
      repository,
      skills: [SESSION_SKILL],
      officeTools: [handoverNoteTool(notes)],
      hooks: {
        PreToolUse: async (input) => {
          if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") {
            return {};
          }
          const { command } = input.tool_input as { command?: unknown };
          return command === ALLOWED_COMMAND
            ? toolDecision("allow")
            : toolDecision("deny", REFUSAL);
        },
      },
    });
    session.send(PROMPT);
    await session.nextResult();
    const calls = toolCalls(session.messages);
    const refused = commandCalls(calls, REFUSED_COMMAND);
    return {
      officeTool: {
        call: observeCall(
          session,
          calls.filter((call) => call.name === officeToolName(HANDOVER_NOTE)),
        ),
        handlerReceived: notes,
      },
      allowedCommand: observeCall(session, commandCalls(calls, ALLOWED_COMMAND)),
      tokenReachedCommands: await readFile(join(repository, TOKEN_REPORT), "utf8").catch(
        () => "not written",
      ),
      refusedCommand: {
        ...observeCall(session, refused),
        reasonReachedModel: refused.some((call) =>
          toolResultText(session.messages, call.id).includes(REFUSAL),
        ),
      },
      skill: observeCall(
        session,
        calls.filter((call) => call.name === "Skill"),
      ),
      hookEvents: sortedNames(new Set(session.hookCalls.map((call) => call.event))),
      endpoints: {
        hookWithToken: session.hookRequests.withToken > 0,
        hookRefused: session.hookRequests.refused,
      },
      officeToolMethods: [...new Set(session.officeToolMethods)],
      requestsToHost: requestsToHost(session),
    };
  },
};

function commandCalls(calls: readonly ToolCall[], command: string): ToolCall[] {
  return calls.filter((call) => call.name === "Bash" && call.input["command"] === command);
}
