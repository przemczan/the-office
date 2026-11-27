import type { Message } from "@the-office/contracts";

/** The user's message as the log has it. */
export type UserMessage = Extract<Message, { kind: "user" }>;

/**
 * The log's line that the user stopped the person (spec §2.4.5, "Stop in a person's Thread"). Kept
 * in one place: it is the held line of a Stop.
 */
function isStoppedLine(message: Message): boolean {
  return message.kind === "held" && message.heldBy === "stop";
}

/**
 * The user's messages the Stop kept from landing, by id: not delivered, with the stopped line after
 * them and no message that did land between. Each says whether to offer Send again, which it
 * doesn't once a later message of the user's says the same words. A Stage Thread has none: its
 * Stop holds the Task, and its messages end with the Stage.
 */
export function stoppedMessages(
  messages: readonly Message[],
  stageThread: boolean,
): ReadonlyMap<string, boolean> {
  const stopped = new Map<string, boolean>();
  if (stageThread) return stopped;
  let stoppedAfter = false;
  const laterTexts = new Set<string>();
  for (const message of messages.toReversed()) {
    if (isStoppedLine(message)) {
      stoppedAfter = true;
    } else if (message.kind === "user") {
      if (message.delivery !== "not-delivered") stoppedAfter = false;
      else if (stoppedAfter) stopped.set(message.id, !laterTexts.has(message.text));
      laterTexts.add(message.text);
    }
  }
  return stopped;
}
