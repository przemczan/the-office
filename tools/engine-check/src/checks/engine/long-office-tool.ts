import { tool } from "@anthropic-ai/claude-agent-sdk";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { Check } from "../../check.ts";
import type { OfficeTool } from "../../claude-code-p/office-tool-server.ts";
import { officeToolName } from "../../office-options.ts";
import type { ProbeSession } from "../../probe-session.ts";
import { lastOutcome, toolCalls, toolResultText } from "../tool-calls.ts";
import { textResult, withOfficeTools } from "./office-tools.ts";

export const LONG_TOOL_VARIABLE = "ENGINE_CHECK_LONG_TOOL_MINUTES";
/** Past the 10 minutes a Project's test run may take through `run_project_command`. */
export const DEFAULT_LONG_TOOL_MINUTES = 11;
const TOOL = "run_project_command";
const ANSWER = "The tests passed, exit code 0.";
const PROMPT = `Call the ${TOOL} tool once, with no arguments. It takes a long time: wait for it. Then reply with just its answer.`;

const toolMs = longToolMinutes() * 60 * 1000;

/**
 * An Office tool that runs a Project's command answers only once the command ends, which may take
 * many minutes (spec §6, "Agents run checks through an Office tool"). Neither route may cut the
 * call short: the binary's MCP tool timeout (`MCP_TOOL_TIMEOUT`, which the session's environment
 * doesn't carry), the SDK's control requests, or the `-p` stream.
 */
export const longOfficeToolCheck: Check = {
  id: "engine.long-office-tool",
  title: "an in-process Office tool that answers after the wait isn't cut short",
  slow: true,
  timeoutMs: toolMs + 10 * 60 * 1000,
  async run({ sandbox, startSession, signal }) {
    const repository = await sandbox.createRepository();
    const answered: number[] = [];
    const session = await startSession({
      repository,
      ...withOfficeTools([
        tool(TOOL, "Runs the Project's tests and answers once they end.", {}, async () => {
          await delay(toolMs, undefined, { signal });
          answered.push(Date.now());
          return textResult(ANSWER);
        }),
      ]),
    });
    session.send(PROMPT);
    await session.nextResult();
    return observed(session, answered);
  },
};

/** The same through the `-p` fallback's Office tools, served through the binary's stream. */
export const fallbackLongOfficeToolCheck: Check = {
  id: "fallback.long-office-tool",
  title: "an Office tool served through the stream that answers after the wait isn't cut short",
  slow: true,
  timeoutMs: toolMs + 10 * 60 * 1000,
  async run({ sandbox, startClaudeCodePSession, signal }) {
    const repository = await sandbox.createRepository();
    const answered: number[] = [];
    const runTests: OfficeTool = {
      name: TOOL,
      description: "Runs the Project's tests and answers once they end.",
      input: { note: z.string().optional() },
      run: async () => {
        await delay(toolMs, undefined, { signal });
        answered.push(Date.now());
        return ANSWER;
      },
    };
    const session = await startClaudeCodePSession({ repository, officeTools: [runTests] });
    session.send(PROMPT);
    await session.nextResult();
    return observed(session, answered);
  },
};

function observed(session: Pick<ProbeSession, "messages">, answered: readonly number[]) {
  const calls = toolCalls(session.messages).filter((call) => call.name === officeToolName(TOOL));
  const last = calls.at(-1);
  return {
    toolMinutes: longToolMinutes(),
    calls: calls.length,
    handlerAnswered: answered.length > 0,
    outcome: lastOutcome(calls),
    agentReadTheAnswer:
      last !== undefined && toolResultText(session.messages, last.id).includes(ANSWER),
  };
}

function longToolMinutes(): number {
  const minutes = Number(process.env[LONG_TOOL_VARIABLE] ?? DEFAULT_LONG_TOOL_MINUTES);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_LONG_TOOL_MINUTES;
}
