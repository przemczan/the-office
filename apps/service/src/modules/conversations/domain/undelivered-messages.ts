import type { Message } from "./message.js";

type UserMessage = Extract<Message, { kind: "user" }>;

/**
 * The user's messages into a Stage Thread since `since` that never reached the person: the Stage's
 * session ended first, as when the user stopped it. They go with the Stage's next run, so a message
 * and a Stop redirect the Agent (spec §2.4).
 */
export function undeliveredSince(log: readonly Message[], since: Date): UserMessage[] {
  return log.filter(
    (message): message is UserMessage =>
      message.kind === "user" && message.delivery === "not-delivered" && message.at >= since,
  );
}

/** The user's messages sent into a Stage's session that haven't landed yet, by their ids. */
export function waitingMessageIds(log: readonly Message[]): string[] {
  return log.flatMap((message) =>
    message.kind === "user" && message.delivery === "waiting" ? [message.id] : [],
  );
}

/** The Stage's work with the user's undelivered messages after it, each quoted as written. */
export function workWithUndelivered(work: string, messages: readonly UserMessage[]): string {
  if (messages.length === 0) return work;
  // The images themselves come with the work; each is named under its message.
  const quoted = messages.map(({ text, images = [] }) =>
    [
      ...(text === "" ? [] : text.split("\n")),
      ...images.map(({ attachmentId, name }) => `image ${name} · Attachment ${attachmentId}`),
    ]
      .map((line) => `> ${line}`)
      .join("\n"),
  );
  return `${work}\n\n## The user's messages\n\nThe user wrote these to you while the Stage ran; they hadn't reached you when it was held. Act on them:\n\n${quoted.join("\n\n")}`;
}
