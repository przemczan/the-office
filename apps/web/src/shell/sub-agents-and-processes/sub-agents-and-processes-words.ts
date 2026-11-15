import type {
  Ending,
  Thread,
  Process,
  SubAgent,
  SubAgentOrProcess,
  SubAgentOrProcessState,
} from "@the-office/contracts";
import { tokensShort } from "../conversation/context-words.ts";
import { threadTitle } from "../conversation/thread-title.ts";
import { clockOf } from "../time.ts";

// The words of spec 2.9's line and view (docs/design/sub-agents-and-processes.html). In code a
// Process is never a variable named `process`, which is Node's global.

/** A piece of the line: the counts of what runs (or ended) stand out, "1 failed" shows in red. */
export interface LinePiece {
  readonly text: string;
  readonly look?: "counted" | "failed";
}

export interface LineWords {
  /** Something still runs: the line has the live dot. */
  readonly live: boolean;
  readonly pieces: readonly LinePiece[];
}

/**
 * What the line says: what runs and how many ended, of which how many failed ("2 sub-agents, 1
 * process running · 3 ended, 1 failed"); once none runs, how many ended ("3 sub-agents, 1 process
 * ended · 1 failed"). Undefined while the session has had none, when the line doesn't show.
 */
export function lineWords(items: readonly SubAgentOrProcess[]): LineWords | undefined {
  if (items.length === 0) return undefined;
  const running = items.filter(({ state }) => state === "running");
  const ended = items.filter(({ state }) => state !== "running");
  const failed = ended.filter(({ state }) => state === "failed").length;
  const failedPieces = (separator: string): LinePiece[] =>
    failed > 0 ? [{ text: separator }, { text: `${failed} failed`, look: "failed" }] : [];
  if (running.length > 0) {
    return {
      live: true,
      pieces: [
        { text: countedWords(running), look: "counted" },
        { text: " running" },
        ...(ended.length > 0 ? [{ text: ` · ${ended.length} ended` }] : []),
        ...failedPieces(", "),
      ],
    };
  }
  return {
    live: false,
    pieces: [
      { text: countedWords(ended), look: "counted" },
      { text: " ended" },
      ...failedPieces(" · "),
    ],
  };
}

export function lineText(words: LineWords): string {
  return words.pieces.map(({ text }) => text).join("");
}

/** "2 sub-agents, 1 process", a kind with none left out. */
function countedWords(items: readonly SubAgentOrProcess[]): string {
  const subAgents = items.filter(({ kind }) => kind === "sub-agent").length;
  const processes = items.length - subAgents;
  return [
    subAgents > 0 ? plural(subAgents, "sub-agent", "sub-agents") : undefined,
    processes > 0 ? plural(processes, "process", "processes") : undefined,
  ]
    .filter((words) => words !== undefined)
    .join(", ");
}

/** The view's list: what runs on top, then what ended, the one that ended last first. */
export function listGroups(items: readonly SubAgentOrProcess[]): {
  readonly running: readonly SubAgentOrProcess[];
  readonly ended: readonly SubAgentOrProcess[];
} {
  return {
    running: items.filter(({ state }) => state === "running"),
    ended: items
      .filter(({ state }) => state !== "running")
      .toSorted((first, second) => (second.endedAt ?? "").localeCompare(first.endedAt ?? "")),
  };
}

/** How the view names it: its description, or a Process's command when it has none. */
export function itemTitle(item: SubAgentOrProcess): string {
  if (item.description !== "") return item.description;
  return item.kind === "process" ? item.commandLine : "Sub-agent";
}

/** "Process", "Sub-agent · Explore". */
export function kindWords(item: SubAgentOrProcess): string {
  if (item.kind === "process") return "Process";
  return item.agentKind === null ? "Sub-agent" : `Sub-agent · ${item.agentKind}`;
}

export const STATE_WORDS: Readonly<Record<SubAgentOrProcessState, string>> = {
  running: "Running",
  finished: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

type StoppedBy = Extract<Ending, { state: "stopped" }>["by"];

const STOPPED_BY: Readonly<Record<StoppedBy, string>> = {
  agent: "by the Agent",
  interrupt: "when the turn was interrupted",
  "session-end": "with the session",
  // After a restart nothing sees the session, and a command may still run: the words don't claim
  // it stopped.
  restart: "· ended when The Office restarted",
};

/** Its state, with how it ended where the list says so: "Failed · exit code 1", "Stopped by the Agent". */
export function stateWords(item: SubAgentOrProcess): string {
  const state = STATE_WORDS[item.state];
  if (item.state === "failed" && item.kind === "process" && item.exitCode !== null) {
    return `${state} · exit code ${item.exitCode}`;
  }
  if (item.ending?.state === "stopped") return `${state} ${STOPPED_BY[item.ending.by]}`;
  return state;
}

/** Each list item's second line: "Process · Failed · exit code 1 · 3m 10s". */
export function secondLine(item: SubAgentOrProcess, now: Date): string {
  return `${kindWords(item)} · ${stateWords(item)} · ${timeWords(item, now)}`;
}

/** How long it ran, with a Sub-agent's context size when the engine gave one: "3m 12s · 45k context". */
export function timeWords(item: SubAgentOrProcess, now: Date): string {
  const context = contextWords(item);
  const ran = ranWords(ranFor(item, now));
  return context === undefined ? ran : `${ran} · ${context}`;
}

/**
 * A Sub-agent's context size, "45k context", as the engine reported it last: while it runs, from
 * its progress, then from its end. Undefined with no figure (never "0 context") and for a Process.
 */
export function contextWords(item: SubAgentOrProcess): string | undefined {
  if (item.kind !== "sub-agent" || item.totalTokens === null || item.totalTokens <= 0) {
    return undefined;
  }
  return `${tokensShort(item.totalTokens)} context`;
}

/** How long it ran, or has run so far. */
export function ranFor(item: SubAgentOrProcess, now: Date): number {
  const end = item.endedAt === null ? now.getTime() : Date.parse(item.endedAt);
  return Math.max(0, end - Date.parse(item.startedAt));
}

/** "45s", "1m 12s", "1h 05m": precise enough to see a running one tick. */
export function ranWords(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${twoDigits(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${twoDigits(Math.floor((seconds % 3600) / 60))}m`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** Who started it: the session's person, or the Sub-agent that did, by its description. */
export function startedByWords(
  item: SubAgentOrProcess,
  items: readonly SubAgentOrProcess[],
  personName: string,
): string {
  if (item.startedBy === null) return personName;
  const starter = items.find(({ callId }) => callId === item.startedBy);
  return starter === undefined ? "a sub-agent" : `the sub-agent “${itemTitle(starter)}”`;
}

/** The details' facts under its title: who started it and when, how long, its id or its calls. */
export function factWords(
  item: SubAgentOrProcess,
  items: readonly SubAgentOrProcess[],
  personName: string,
  now: Date,
): readonly string[] {
  const ran = ranWords(ranFor(item, now));
  return [
    `Started by ${startedByWords(item, items, personName)} at ${clockOf(item.startedAt)}`,
    item.endedAt === null ? `running for ${ran}` : `ran ${ran}, until ${clockOf(item.endedAt)}`,
    ...(item.kind === "process" ? processFacts(item) : subAgentFacts(item)),
  ];
}

function processFacts(startedProcess: Process): string[] {
  return startedProcess.engineTaskId === null ? [] : [`id ${startedProcess.engineTaskId}`];
}

function subAgentFacts(subAgent: SubAgent): string[] {
  return subAgent.toolCallCount === null
    ? []
    : [plural(subAgent.toolCallCount, "tool call", "tool calls")];
}

export type EndingTone = "finished" | "failed" | "stopped";

/**
 * The strip that says how it ended. A finished Sub-agent has none: what it reported back says it.
 * The exit code shows only where the engine gives one (Claude Code's end notice has none).
 */
export function endingStrip(
  item: SubAgentOrProcess,
): { readonly tone: EndingTone; readonly words: string } | undefined {
  const { ending, endedAt } = item;
  if (ending === null || endedAt === null) return undefined;
  const at = clockOf(endedAt);
  switch (ending.state) {
    case "finished":
      if (item.kind === "sub-agent") return undefined;
      return {
        tone: "finished",
        words:
          item.exitCode === null
            ? `Finished at ${at}.`
            : `Finished with exit code ${item.exitCode} at ${at}.`,
      };
    case "failed": {
      const how =
        item.kind === "process" && item.exitCode !== null
          ? `Failed with exit code ${item.exitCode} at ${at}.`
          : `Failed at ${at}.`;
      return { tone: "failed", words: ending.reason === "" ? how : `${how} ${ending.reason}` };
    }
    case "stopped":
      return {
        tone: "stopped",
        words:
          ending.by === "restart"
            ? `Ended when The Office restarted, at ${at}. It may still be running on the machine.`
            : `Stopped ${STOPPED_BY[ending.by]} at ${at}${ending.by === "agent" ? " (TaskStop)" : ""}.`,
      };
  }
}

/** "1.9 MB of earlier output isn't kept. The last 256 KB show here." */
export function earlierOutputWords(bytes: number): string | undefined {
  if (bytes === 0) return undefined;
  return `${sizeWords(bytes)} of earlier output isn't kept. The last 256 KB show here.`;
}

/** "12 earlier messages and tool calls aren't kept." */
export function earlierMessagesWords(count: number): string | undefined {
  if (count === 0) return undefined;
  return count === 1
    ? "1 earlier message or tool call isn't kept."
    : `${count} earlier messages and tool calls aren't kept.`;
}

const KB = 1024;
const MB = 1024 * KB;

/** "1.9 MB", "340 KB", "512 bytes". */
export function sizeWords(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return plural(bytes, "byte", "bytes");
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Whose Thread the window shows, under its title: "Jim's chat · Try a search index". */
export function whereWords(thread: Thread, personName: string): string {
  const title = threadTitle(thread, personName);
  return thread.home.kind === "chat" ? `${personName}'s chat · ${title}` : title;
}
