import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { Check, CheckContext, Observation } from "../../check.ts";
import type { RecordedSession, SessionHook } from "../../recorded-session.ts";
import { toolCalls, toolResultText, toolUseResult } from "../tool-calls.ts";
import { turnEnding } from "./running-command.ts";

const SUB_AGENT_TOOLS = new Set(["Task", "Agent"]);
/** What the Sub-agent answers, which the Agent can only repeat if the answer came within its turn. */
const ANSWER = "foreground-17";

const PROMPT =
  'Start a sub-agent with the Agent tool (subagent_type: "general-purpose", model: "haiku", ' +
  'run_in_background: true, description: "Say the word") whose prompt is: ' +
  `Reply with just the word ${ANSWER}. Do not call any tool. ` +
  "Make that one call, do not retry it, then reply with just what the sub-agent answered.";

/** How a check starts a session on its route. */
type Start = (
  context: CheckContext,
  repository: string,
  hook: SessionHook,
) => Promise<RecordedSession>;

/**
 * Whether the engine runs a Sub-agent call in the foreground when an allowing `PreToolUse` hook
 * answers it with `updatedInput` saying so, though the model asked for the background: the
 * Office rules hook does so in a Stage session (spec §2.9), whose turn's end is its result.
 */
export const foregroundSubAgentsCheck: Check = {
  id: "engine.foreground-sub-agents",
  title:
    "a Sub-agent asked for in the background runs in the foreground when the hook's updatedInput says so",
  timeoutMs: 4 * 60 * 1000,
  run: (context) =>
    observeForegroundSubAgent(context, ({ startSession }, repository, hook) =>
      startSession({ repository, hooks: { PreToolUse: hook } }),
    ),
};

/** The same on the `-p` fallback, whose hook answers over `localhost`. */
export const fallbackForegroundSubAgentsCheck: Check = {
  id: "fallback.foreground-sub-agents",
  title:
    "a Sub-agent asked for in the background runs in the foreground on -p when the hook's updatedInput says so",
  timeoutMs: 4 * 60 * 1000,
  run: (context) =>
    observeForegroundSubAgent(context, ({ startClaudeCodePSession }, repository, hook) =>
      startClaudeCodePSession({ repository, hooks: { PreToolUse: hook } }),
    ),
};

/** Allows a Sub-agent call with its input made to run in the foreground, as the Office rules hook does. */
const foregroundSubAgents: SessionHook = async (input) => {
  if (input.hook_event_name !== "PreToolUse" || !SUB_AGENT_TOOLS.has(input.tool_name)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...(input.tool_input as object), run_in_background: false },
    },
  } satisfies HookJSONOutput;
};

async function observeForegroundSubAgent(
  context: CheckContext,
  start: Start,
): Promise<Observation> {
  const repository = await context.sandbox.createRepository();
  const session = await start(context, repository, foregroundSubAgents);
  session.send(PROMPT);
  const turn = await session.nextResult();
  const call = toolCalls(session.messages).find(({ name }) => SUB_AGENT_TOOLS.has(name));
  if (call === undefined) return { turnEnded: turnEnding(turn), subAgentCall: "not attempted" };
  const structured = toolUseResult(session.messages, call.id) as { status?: unknown } | undefined;
  const started = session.messages.find(
    (message) =>
      message.type === "system" &&
      message.subtype === "task_started" &&
      message.tool_use_id === call.id,
  );
  return {
    turnEnded: turnEnding(turn),
    callAskedForBackground: call.input["run_in_background"] === true,
    callResultStatus: typeof structured?.status === "string" ? structured.status : null,
    isBackgrounded:
      started?.type === "system" && started.subtype === "task_started"
        ? (started.is_backgrounded ?? null)
        : null,
    answerInCallResult: toolResultText(session.messages, call.id).includes(ANSWER),
    answerInTurnResult: turn.subtype === "success" && turn.result.includes(ANSWER),
  };
}
