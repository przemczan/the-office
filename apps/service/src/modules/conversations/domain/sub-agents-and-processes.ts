import type { Home } from "./thread.js";

/**
 * Sub-agents and Processes (spec 2.9): what a session's Agent starts beside its own work, kept by
 * Conversations for the rest of the session. Both are known by `callId`, the id of the tool call
 * that started them, in their session.
 */

/** How one ended. "restart" is The Office's own: no engine saw it end. */
export type Ending =
  | { readonly state: "finished" }
  | { readonly state: "failed"; readonly reason: string }
  | {
      readonly state: "stopped";
      readonly by: "agent" | "interrupt" | "session-end" | "restart";
    };

export type ItemState = "running" | Ending["state"];

/** What both kinds hold. */
interface ItemFields {
  readonly threadId: string;
  /** The engine session that started it, which it belongs to. */
  readonly sessionId: string;
  readonly callId: string;
  /** The engine's own id, which TaskStop names, once the engine gave it. */
  readonly engineTaskId: string | undefined;
  /** The Sub-agent that started it, by its `callId`, or undefined for the session's Agent. */
  readonly startedBy: string | undefined;
  readonly description: string;
  /** Undefined while it runs. */
  readonly ending: Ending | undefined;
  readonly startedAt: Date;
  readonly endedAt: Date | undefined;
  /** Counts its changes, so a page keeps the newest copy whatever order they reach it in. */
  readonly revision: number;
  /** The sequence of its last message or output chunk; 0 before the first. */
  readonly lastSequence: number;
}

export interface SubAgent extends ItemFields {
  readonly kind: "sub-agent";
  /** Such as "general-purpose" or "Explore", when its call names one. */
  readonly agentKind: string | undefined;
  /** The brief it was given. */
  readonly prompt: string;
  readonly background: boolean;
  readonly reportedBack: string | undefined;
  readonly toolCallCount: number | undefined;
  readonly totalTokens: number | undefined;
  /** How many of its earliest messages and tool calls aren't kept (`MESSAGES_KEPT`). */
  readonly earlierMessagesNotKept: number;
}

export interface Process extends ItemFields {
  readonly kind: "process";
  /** Whole, as the call gave it. */
  readonly commandLine: string;
  /** Its exit code, when the engine gives one. */
  readonly exitCode: number | undefined;
  /** How many bytes of its earliest output aren't kept (`OUTPUT_KEPT_BYTES`). */
  readonly earlierOutputNotKept: number;
}

export type SubAgentOrProcess = SubAgent | Process;

/** A Sub-agent's message or tool call, as a Thread logs its Agent's, through the Project's mask. */
export type SubAgentMessageDraft =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool-activity"; readonly tool: string; readonly summary: string }
  | { readonly kind: "refusal"; readonly tool: string; readonly reason: string };

export type SubAgentMessage = SubAgentMessageDraft & {
  readonly sequence: number;
  readonly at: Date;
};

export interface OutputChunk {
  readonly sequence: number;
  readonly text: string;
}

/** Where a session's Sub-agents and Processes belong, for the web's events. */
export interface SessionWhere {
  readonly threadId: string;
  readonly home: Home;
  readonly sessionId: string;
}

/** A Process keeps the last 256 KB of its output, counted after masking. */
export const OUTPUT_KEPT_BYTES = 256 * 1024;

/** A Sub-agent keeps its last 1,000 messages and tool calls. */
export const MESSAGES_KEPT = 1_000;

/** A session keeps its latest 100 ended Sub-agents and Processes; Running ones are always kept. */
export const ENDED_ITEMS_KEPT = 100;

export const RESTART_ENDING: Ending = { state: "stopped", by: "restart" };

export const SESSION_END_ENDING: Ending = { state: "stopped", by: "session-end" };

export function stateOf(item: SubAgentOrProcess): ItemState {
  return item.ending?.state ?? "running";
}

/**
 * The item ended as `ending` says, at `at`, with what the end adds. A state only moves forward: one
 * already ended stays as it ended, so a late or repeated end changes nothing (undefined). An end
 * that gives no context size keeps the one its progress gave.
 */
export function endItem<Item extends SubAgentOrProcess>(
  item: Item,
  ending: Ending,
  at: Date,
  added: Partial<Pick<SubAgent, "reportedBack" | "toolCallCount" | "totalTokens">> &
    Partial<Pick<Process, "exitCode">> = {},
): Item | undefined {
  if (item.ending !== undefined) return undefined;
  const kept =
    item.kind === "sub-agent" && added.totalTokens === undefined
      ? { ...added, totalTokens: item.totalTokens }
      : added;
  return { ...item, ...kept, ending, endedAt: at, revision: item.revision + 1 };
}

/**
 * A running Sub-agent's context size, as the engine's progress reports it: a revision, so it
 * streams like any change. Once it ended, or with no new size, nothing changes (undefined).
 */
export function progressSubAgent(subAgent: SubAgent, totalTokens: number): SubAgent | undefined {
  if (subAgent.ending !== undefined || subAgent.totalTokens === totalTokens) return undefined;
  return { ...subAgent, totalTokens, revision: subAgent.revision + 1 };
}

/** The engine told more of a Sub-agent after its start: kept even once it ended. */
export function changeSubAgent(
  subAgent: SubAgent,
  change: Pick<SubAgent, "engineTaskId" | "background">,
): SubAgent | undefined {
  const engineTaskId = change.engineTaskId ?? subAgent.engineTaskId;
  if (engineTaskId === subAgent.engineTaskId && change.background === subAgent.background) {
    return undefined;
  }
  return {
    ...subAgent,
    engineTaskId,
    background: change.background,
    revision: subAgent.revision + 1,
  };
}

/**
 * What to drop from the start of a Process's kept output, oldest first, so it holds `limit` bytes
 * at most: whole chunks, then the head of the first chunk kept, cut on a character's boundary.
 */
export interface OutputTrim {
  readonly droppedSequences: readonly number[];
  /** The first chunk kept, shortened, when part of it goes. */
  readonly shortened: OutputChunk | undefined;
  readonly droppedBytes: number;
}

export function outputTrim(
  keptOldestFirst: readonly OutputChunk[],
  limit: number = OUTPUT_KEPT_BYTES,
): OutputTrim {
  let over = keptOldestFirst.reduce((sum, chunk) => sum + byteLength(chunk.text), 0) - limit;
  const droppedSequences: number[] = [];
  let droppedBytes = 0;
  for (const chunk of keptOldestFirst) {
    if (over <= 0) break;
    const bytes = byteLength(chunk.text);
    if (bytes <= over) {
      droppedSequences.push(chunk.sequence);
      droppedBytes += bytes;
      over -= bytes;
      continue;
    }
    const text = tailWithin(chunk.text, bytes - over);
    const dropped = bytes - byteLength(text);
    return {
      droppedSequences,
      shortened: { sequence: chunk.sequence, text },
      droppedBytes: droppedBytes + dropped,
    };
  }
  return { droppedSequences, shortened: undefined, droppedBytes };
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** The longest end of `text` within `bytes`, never splitting a character. */
function tailWithin(text: string, bytes: number): string {
  const encoded = Buffer.from(text, "utf8");
  let start = encoded.length - bytes;
  // A UTF-8 continuation byte is 10xxxxxx: step past it to the next character's start.
  while (start < encoded.length && ((encoded[start] ?? 0) & 0xc0) === 0x80) start += 1;
  return encoded.subarray(start).toString("utf8");
}

/**
 * Hands a Process's output on by whole lines, as the Project's mask matches within a text: a
 * secret split across two reads would get past it. An unfinished last line is held until its
 * newline comes, or `flush` gives it, at the Process's end or after about a second.
 */
export class WholeLines {
  private held = "";

  /** The complete lines `text` finishes, with the held start of the first; "" while none is. */
  push(text: string): string {
    const all = this.held + text;
    const end = all.lastIndexOf("\n") + 1;
    this.held = all.slice(end);
    return all.slice(0, end);
  }

  /** Whatever is held, which no newline finished yet. */
  flush(): string {
    const held = this.held;
    this.held = "";
    return held;
  }

  get holding(): boolean {
    return this.held !== "";
  }
}
