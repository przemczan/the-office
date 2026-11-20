import { join } from "node:path";
import type { ApprovalCall, CodexSession } from "../../codex/codex-session.ts";
import type {
  ItemNotification,
  RateLimitSnapshot,
  RateLimitWindow,
  ThreadItem,
  Turn,
} from "../../codex/protocol.ts";
import type { Observation } from "../../check.ts";
import { pathExists } from "../paths.ts";

export type CommandItem = Extract<ThreadItem, { type: "commandExecution" }>;
export type FileChangeItem = Extract<ThreadItem, { type: "fileChange" }>;

/** How a turn ended, with the error kind of one that failed. */
export function turnEnding(turn: Turn): string {
  if (turn.error === null) {
    return turn.status;
  }
  const info = turn.error.codexErrorInfo;
  return `${turn.status}: ${typeof info === "string" ? info : JSON.stringify(info)}`;
}

/** A shell command writing one file with Node, so it runs the same on Windows and Linux. */
export function writeFileCommand(path: string): string {
  return `node -e "require('fs').writeFileSync('${path.replaceAll("\\", "/")}', 'written')"`;
}

/** The completed command items, of every turn or the one named, whose command names `fragment`. */
export function commandItems(
  session: CodexSession,
  fragment: string,
  turnId?: string,
): CommandItem[] {
  return session
    .completedItems(turnId)
    .filter((item): item is CommandItem => item.type === "commandExecution")
    .filter((item) => item.command.includes(fragment));
}

/** The completed file changes, of every turn, touching a file named `fileName`. */
export function fileChangeItems(session: CodexSession, fileName: string): FileChangeItem[] {
  return session
    .completedItems()
    .filter((item): item is FileChangeItem => item.type === "fileChange")
    .filter((item) => item.changes.some((change) => change.path.endsWith(fileName)));
}

/** The item an approval request is about, from its `item/started`, if the app-server sent one first. */
export function approvedItem(session: CodexSession, call: ApprovalCall): ThreadItem | undefined {
  return session.messages
    .filter((message) => message.method === "item/started")
    .map((message) => (message.params as ItemNotification).item)
    .find((item) => item.id === call.params.itemId);
}

/** Whether an approval request asked about a command or file change naming `fragment`. */
export function askedAbout(session: CodexSession, fragment: string): boolean {
  return session.approvalCalls.some((call) => mentions(session, call, fragment));
}

export function mentions(session: CodexSession, call: ApprovalCall, fragment: string): boolean {
  if (call.params.command?.includes(fragment) === true) {
    return true;
  }
  const item = approvedItem(session, call);
  if (item?.type === "commandExecution") {
    return (item as CommandItem).command.includes(fragment);
  }
  if (item?.type === "fileChange") {
    return (item as FileChangeItem).changes.some((change) => change.path.endsWith(fragment));
  }
  return false;
}

/** Sorted, distinct statuses of the items, `none` when there are none. */
export function itemStatuses(items: readonly { readonly status: string }[]): string[] {
  const statuses = [...new Set(items.map((item) => item.status))].toSorted();
  return statuses.length === 0 ? ["none"] : statuses;
}

export function fileExists(repository: string, name: string): Promise<boolean> {
  return pathExists(join(repository, name));
}

/** A usage window's shape, without its changing numbers. */
export function windowShape(window: RateLimitWindow | null): Observation | null {
  if (window === null) {
    return null;
  }
  return {
    windowDurationMins: window.windowDurationMins,
    usedPercentIsNumber: typeof window.usedPercent === "number",
    resetsAtInFuture: window.resetsAt !== null && window.resetsAt * 1000 > Date.now(),
  };
}

export function snapshotShape(snapshot: RateLimitSnapshot): Observation {
  return {
    limitId: snapshot.limitId,
    primary: windowShape(snapshot.primary),
    secondary: windowShape(snapshot.secondary),
    planTypeGiven: snapshot.planType !== null,
  };
}
