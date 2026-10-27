import { z } from "zod";

/**
 * A record of The Office a chat message can mention (spec §2.4), by the link to its page: the web
 * builds the links, and the service reads the ones in a message to give the Agent their records.
 * Initiatives join with task 22.
 */
export type RecordLink =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "idea"; readonly ideaId: string }
  | {
      readonly kind: "decision";
      readonly taskId: string;
      /** The Thread the Decision was asked in, which the Task page shows first. */
      readonly threadId: string | undefined;
      readonly decisionId: string;
    };

/** The path of the record's page in the web app. */
export function recordPath(link: RecordLink): string {
  switch (link.kind) {
    case "task":
      return `/tasks/${link.taskId}`;
    case "idea":
      return `/work/ideas?idea=${link.ideaId}`;
    case "decision": {
      const thread = link.threadId === undefined ? "" : `taskThread=${link.threadId}&`;
      return `/tasks/${link.taskId}?${thread}decision=${link.decisionId}`;
    }
  }
}

/** The record a link points to, or undefined for any other link. Takes a path or a full URL. */
export function recordLinkOf(href: string): RecordLink | undefined {
  let url: URL;
  try {
    url = new URL(href, BASE);
  } catch {
    return undefined;
  }
  const taskId = TASK_PATH.exec(url.pathname)?.[1];
  if (taskId !== undefined && isUuid(taskId)) {
    const decisionId = url.searchParams.get("decision");
    if (decisionId === null) return { kind: "task", taskId };
    if (!isUuid(decisionId)) return undefined;
    const threadId = url.searchParams.get("taskThread");
    return {
      kind: "decision",
      taskId,
      threadId: threadId !== null && isUuid(threadId) ? threadId : undefined,
      decisionId,
    };
  }
  const ideaId = url.searchParams.get("idea");
  if (IDEAS_PATH.test(url.pathname) && ideaId !== null && isUuid(ideaId)) {
    return { kind: "idea", ideaId };
  }
  return undefined;
}

/**
 * The records a message links to, each once, in the order first linked: Markdown links, as the
 * `@` picker writes them, and pasted URLs alike.
 */
export function recordLinksIn(text: string): RecordLink[] {
  const found = new Map<string, RecordLink>();
  for (const [candidate] of text.matchAll(LINK_CANDIDATE)) {
    // A pasted URL may end a sentence: its punctuation isn't part of it.
    const link = recordLinkOf(candidate.replace(/[.,;:!?]+$/, ""));
    if (link && !found.has(recordKey(link))) found.set(recordKey(link), link);
  }
  return [...found.values()];
}

function recordKey(link: RecordLink): string {
  switch (link.kind) {
    case "task":
      return `task:${link.taskId}`;
    case "idea":
      return `idea:${link.ideaId}`;
    case "decision":
      return `decision:${link.decisionId}`;
  }
}

/** Resolves paths; a full URL keeps its own origin, which the records don't depend on. */
const BASE = "http://the-office.invalid";
const TASK_PATH = /^\/tasks\/([^/]+)\/?$/;
const IDEAS_PATH = /^\/work\/ideas\/?$/;
/** A path or URL up to the next space, bracket or quote, where Markdown and prose end a link. */
const LINK_CANDIDATE = /(?:https?:\/\/[^\s/()<>[\]"']+)?\/(?:tasks|work\/ideas)[^\s()<>[\]"']*/g;

const uuidSchema = z.uuid();

function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}
