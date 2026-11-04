import type { Message } from "@the-office/contracts";

export type TurnMessage = Extract<Message, { kind: "user" | "person" }>;
export type ToolCall = Extract<Message, { kind: "tool-activity" }>;

/** What a log shows as one piece. `id` is its first message's, so it stays as the piece grows. */
export type MessageGroup =
  | {
      readonly kind: "turn";
      readonly id: string;
      readonly messages: readonly [TurnMessage, ...TurnMessage[]];
    }
  | {
      readonly kind: "tool-calls";
      readonly id: string;
      readonly messages: readonly [ToolCall, ...ToolCall[]];
    }
  | {
      readonly kind: "alone";
      readonly id: string;
      readonly message: Exclude<Message, TurnMessage | ToolCall>;
    };

/**
 * One author's neighbouring messages as a turn, and neighbouring tool calls as one block. Anything
 * else stands alone and ends the turn before it: a card or a line said between two messages stays
 * between them. Run it on what will show, so a line left out doesn't split a turn.
 */
export function groupedMessages(messages: readonly Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    const last = groups.at(-1);
    const grown = last && joined(last, message);
    if (grown) groups[groups.length - 1] = grown;
    else groups.push(started(message));
  }
  return groups;
}

function joined(group: MessageGroup, message: Message): MessageGroup | undefined {
  if (group.kind === "turn" && isTurnMessage(message) && sameAuthor(group.messages[0], message)) {
    return { ...group, messages: [...group.messages, message] };
  }
  if (group.kind === "tool-calls" && message.kind === "tool-activity") {
    return { ...group, messages: [...group.messages, message] };
  }
  return undefined;
}

function started(message: Message): MessageGroup {
  if (isTurnMessage(message)) return { kind: "turn", id: message.id, messages: [message] };
  if (message.kind === "tool-activity") {
    return { kind: "tool-calls", id: message.id, messages: [message] };
  }
  return { kind: "alone", id: message.id, message };
}

function isTurnMessage(message: Message): message is TurnMessage {
  return message.kind === "user" || message.kind === "person";
}

/** A Handover note the user passed on is another's words under its own line, so it joins nothing. */
function sameAuthor(a: TurnMessage, b: TurnMessage): boolean {
  if (a.kind === "person") return b.kind === "person" && a.roleKey === b.roleKey;
  return b.kind === "user" && a.handoverNoteFrom === null && b.handoverNoteFrom === null;
}
