import type { SessionEvent } from "@microsoft/copilot-sdk";
import type { TokenUsage } from "../recorded-session.ts";

export type EventOfType<T extends SessionEvent["type"]> = Extract<SessionEvent, { type: T }>;

export function eventsOfType<T extends SessionEvent["type"]>(
  events: readonly SessionEvent[],
  type: T,
): EventOfType<T>[] {
  return events.filter((event): event is EventOfType<T> => event.type === type);
}

/** Where the first event of `type` is in `events`, after `from`; -1 when there is none. */
export function indexOfType(
  events: readonly SessionEvent[],
  type: SessionEvent["type"],
  from = 0,
): number {
  const index = events.slice(from).findIndex((event) => event.type === type);
  return index === -1 ? -1 : from + index;
}

/** Each kind of event once, sorted, without the streaming deltas whose count varies run to run. */
export function eventKinds(events: readonly SessionEvent[]): string[] {
  return [...new Set(events.map((event) => event.type))]
    .filter((type) => !type.endsWith("_delta"))
    .toSorted();
}

/** The tools the session ran, by name, in order, with the root agent's calls apart from Sub-agents'. */
export function toolStarts(
  events: readonly SessionEvent[],
): { readonly toolName: string; readonly subAgent: boolean; readonly input: unknown }[] {
  return eventsOfType(events, "tool.execution_start").map((event) => ({
    toolName: event.data.toolName,
    subAgent: event.agentId !== undefined,
    input: event.data.arguments,
  }));
}

/** The tokens of the session's model calls, from `assistant.usage`, cache writes counted apart. */
export function tokenUsage(events: readonly SessionEvent[]): TokenUsage {
  return eventsOfType(events, "assistant.usage").reduce(
    (total, { data }) => ({
      input: total.input + (data.inputTokens ?? 0),
      output: total.output + (data.outputTokens ?? 0),
      cacheRead: total.cacheRead + (data.cacheReadTokens ?? 0),
      cacheCreation: total.cacheCreation + (data.cacheWriteTokens ?? 0),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  );
}

/** The names of an object's fields, sorted, or none for anything else: what an observation records of a payload. */
export function fieldNames(value: unknown): string[] {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value).toSorted()
    : [];
}

/** The text of the turn's last root `assistant.message`, empty when there is none. */
export function lastAnswer(events: readonly SessionEvent[]): string {
  return (
    eventsOfType(events, "assistant.message")
      .filter((event) => event.agentId === undefined)
      .at(-1)?.data.content ?? ""
  );
}
