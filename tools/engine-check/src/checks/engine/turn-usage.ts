import type {
  SDKAssistantMessage,
  SDKControlInterruptResponse,
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Check } from "../../check.ts";
import {
  allowRunningCommandThen,
  prepareRunningCommand,
  RUN_COMMAND_PROMPT,
  stopBackgroundCommand,
  turnEnding,
} from "./running-command.ts";

const SUBAGENT_PROMPT =
  "Make these tool calls one at a time, waiting for each result: " +
  "1. Start one general-purpose subagent with the Task tool, prompt: 'Read README.md and reply with its first line.' " +
  "2. Read README.md yourself. Then reply in one line with what the subagent answered.";

type Usage = SDKAssistantMessage["message"]["usage"];

/** How the frames sharing a message id carry its usage. */
type SplitFrames = "no id repeats" | "same usage" | "usage grows" | "usage varies";

/** Which messages a result's input-side tokens (input, cache reads and writes) count. */
type ResultCounts =
  | "no tokens"
  | "fewer than the main loop's messages"
  | "the main loop's messages"
  | "between the main loop's and every message"
  | "every message, subagents' too"
  | "more than every message";

/**
 * Live tokens per Thread (spec §2.4, task 13) count a running turn from its assistant messages as
 * they stream and replace that count with the turn's result usage at its end. This checks what that
 * rests on: every frame carries usage, how frames sharing a message id carry it, which messages a
 * result's usage counts with a subagent in the turn, whether a frame's output tokens are the
 * message's final ones, and what an interrupted turn's result reports.
 */
export const turnUsageCheck: Check = {
  id: "engine.turn-usage",
  title: "assistant frames carry usage, and what a result's usage counts, interrupted or not",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    await prepareRunningCommand(repository);
    let receipt: Promise<SDKControlInterruptResponse | undefined> | undefined;
    const session = await startSession({
      repository,
      hooks: {
        PreToolUse: allowRunningCommandThen((running) => {
          receipt = running.control.interrupt();
        }),
      },
    });
    session.send(SUBAGENT_PROMPT);
    const withSubagent = await session.nextResult();
    const firstTurnEnd = session.messages.indexOf(withSubagent);
    session.send(RUN_COMMAND_PROMPT);
    const interrupted = await session.nextResult();
    await receipt;
    await stopBackgroundCommand(session);

    const firstTurn = assistantFrames(session.messages.slice(0, firstTurnEnd + 1));
    const secondTurn = assistantFrames(
      session.messages.slice(firstTurnEnd + 1, session.messages.indexOf(interrupted) + 1),
    );
    const frames = [...firstTurn, ...secondTurn];
    return {
      everyFrameHasUsage: frames.every(({ message }) => hasUsage(message.usage)),
      subagentFramesStreamed: firstTurn.some(isSubagentFrame),
      splitFrames: splitFrames(frames),
      resultWithSubagentCounts: resultCounts(withSubagent, firstTurn),
      resultOutputExceedsFrames: outputExceedsFrames(withSubagent, firstTurn),
      interrupted: {
        turnEnded: turnEnding(interrupted),
        resultCounts: resultCounts(interrupted, secondTurn),
        resultOutputExceedsFrames: outputExceedsFrames(interrupted, secondTurn),
      },
    };
  },
};

function assistantFrames(messages: readonly SDKMessage[]): SDKAssistantMessage[] {
  return messages.filter((message): message is SDKAssistantMessage => message.type === "assistant");
}

function isSubagentFrame({ parent_tool_use_id }: SDKAssistantMessage): boolean {
  return parent_tool_use_id !== null;
}

function hasUsage(usage: Usage | null | undefined): boolean {
  return (
    usage !== undefined &&
    usage !== null &&
    typeof usage.input_tokens === "number" &&
    typeof usage.output_tokens === "number"
  );
}

function inputSideOf(usage: Usage | SDKResultMessage["usage"]): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

/** Each message id's frames, in stream order. */
function framesById(frames: readonly SDKAssistantMessage[]): SDKAssistantMessage[][] {
  const byId = new Map<string, SDKAssistantMessage[]>();
  for (const frame of frames) {
    byId.set(frame.message.id, [...(byId.get(frame.message.id) ?? []), frame]);
  }
  return [...byId.values()];
}

function splitFrames(frames: readonly SDKAssistantMessage[]): SplitFrames {
  const repeated = framesById(frames).filter((shared) => shared.length > 1);
  if (repeated.length === 0) return "no id repeats";
  const usages = repeated.map((shared) => shared.map(({ message }) => message.usage));
  const same = usages.every((each) =>
    each.every(
      (usage) =>
        inputSideOf(usage) === inputSideOf(each[0]!) &&
        usage.output_tokens === each[0]!.output_tokens,
    ),
  );
  if (same) return "same usage";
  const grows = usages.every((each) =>
    each.every((usage, i) => i === 0 || usage.output_tokens >= each[i - 1]!.output_tokens),
  );
  return grows ? "usage grows" : "usage varies";
}

/** Summed over messages, each at its latest frame's usage, as the running count takes them. */
function messagesSum(
  frames: readonly SDKAssistantMessage[],
  part: (usage: Usage) => number,
): number {
  return framesById(frames).reduce((sum, shared) => sum + part(shared.at(-1)!.message.usage), 0);
}

function resultCounts(
  result: SDKResultMessage,
  frames: readonly SDKAssistantMessage[],
): ResultCounts {
  const counted = inputSideOf(result.usage);
  const mainLoop = messagesSum(
    frames.filter((frame) => !isSubagentFrame(frame)),
    inputSideOf,
  );
  const every = messagesSum(frames, inputSideOf);
  if (counted === 0) return "no tokens";
  if (counted < mainLoop) return "fewer than the main loop's messages";
  if (counted === mainLoop) return "the main loop's messages";
  if (counted < every) return "between the main loop's and every message";
  if (counted === every) return "every message, subagents' too";
  return "more than every message";
}

/** A frame carries the output tokens known as its message began, so a result's are larger. */
function outputExceedsFrames(
  result: SDKResultMessage,
  frames: readonly SDKAssistantMessage[],
): boolean {
  const mainLoop = frames.filter((frame) => !isSubagentFrame(frame));
  return result.usage.output_tokens > messagesSum(mainLoop, (usage) => usage.output_tokens);
}
