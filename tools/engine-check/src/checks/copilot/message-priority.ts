import type { SessionEvent } from "@microsoft/copilot-sdk";
import type { Check } from "../../check.ts";
import { eventsOfType, indexOfType } from "../../copilot-cli/events.ts";
import { answerHolds, isShellTool, shellStarts } from "./helpers.ts";

type Mode = "immediate" | "enqueue";

const WORD = "NOTED";
const BARGE_IN = `Also include the word ${WORD} in your final reply.`;
// `sleep` is a PowerShell alias of Start-Sleep too, so the prompt holds on both platforms.
const PROMPT =
  "Run the shell command `sleep 4`, wait for it to finish, then run `sleep 4` again as a second, separate shell call. " +
  "Make the calls one after the other, never together. Then reply DONE.";

export type Landing = "before-second-call" | "after-second-call" | "after-turn" | "not-delivered";

/** Where the message landed: against the turn's second shell call and its first idle. */
export function landing(events: readonly SessionEvent[], messageIndex: number): Landing {
  if (messageIndex === -1) {
    return "not-delivered";
  }
  const firstIdle = indexOfType(events, "session.idle");
  if (firstIdle !== -1 && firstIdle < messageIndex) {
    return "after-turn";
  }
  const secondCall = events.findIndex(
    (event, index) =>
      event.type === "tool.execution_start" &&
      event.agentId === undefined &&
      isShellTool(event.data.toolName) &&
      shellStarts(events.slice(0, index)).length === 1,
  );
  return secondCall === -1 || messageIndex < secondCall
    ? "before-second-call"
    : "after-second-call";
}

function priorityCheck(mode: Mode, id: string, title: string): Check {
  return {
    id,
    title,
    timeoutMs: 6 * 60 * 1000,
    async run({ sandbox, startCopilotSession }) {
      const session = await startCopilotSession({ repository: await sandbox.createRepository() });
      const from = session.events.length;
      await session.send(PROMPT);
      await session.waitFor(
        (event) =>
          event.type === "tool.execution_start" &&
          event.agentId === undefined &&
          isShellTool(event.data.toolName),
        from,
      );
      await session.send(BARGE_IN, { mode });
      const messageAt = await session.waitFor(
        (event) => event.type === "user.message" && event.data.content.includes(BARGE_IN),
        from,
      );
      await session.untilIdle(messageAt);
      const events = session.events.slice(from);
      return {
        landed: landing(
          events,
          events.findIndex(
            (event) => event.type === "user.message" && event.data.content.includes(BARGE_IN),
          ),
        ),
        idles: eventsOfType(events, "session.idle").length,
        secondCallRan: shellStarts(events).length >= 2,
        answerHoldsWord: answerHolds(events, WORD),
      };
    },
  };
}

/**
 * Next priority on the Copilot engine: a message sent with `mode: "immediate"` while the turn's
 * first shell call runs is read before the turn's next call, within the same turn.
 */
export const copilotPriorityNextCheck = priorityCheck(
  "immediate",
  "copilot.priority-next",
  "a message sent with mode immediate during a shell call lands before the turn's next call",
);

/**
 * Later priority on the Copilot engine: a message sent with `mode: "enqueue"` while the turn's
 * first shell call runs waits until the turn ends, then runs as a turn of its own.
 */
export const copilotPriorityLaterCheck = priorityCheck(
  "enqueue",
  "copilot.priority-later",
  "a message sent with mode enqueue during a shell call waits for the turn's end",
);
