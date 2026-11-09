import { estimatedTokens, type Brief } from "./brief.js";
import type { Mention } from "./mention.js";
import type { Message } from "./message.js";

/**
 * The Open page (spec §2.4): the record whose page is open beside the chat drawer as the user sends
 * a message there. The person answering is given its record with the message, as a Mention's.
 */
export type OpenPage =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | { readonly kind: "idea"; readonly ideaId: string }
  | { readonly kind: "person"; readonly roleKey: string }
  | { readonly kind: "project"; readonly projectId: string };

/** The Open page's record as the session reads it; undefined when The Office has no such record. */
export interface OpenPageRecord {
  readonly page: OpenPage;
  readonly text: string | undefined;
}

/** What a message sent with an Open page has to decide whether its record is given. */
export interface OpenPageGiving {
  /** The Open page the message was sent with, if any. */
  readonly openPage: OpenPage | undefined;
  /** The records the message mentions, each given already. */
  readonly mentions: readonly Mention[];
  /** The Thread's log before the message. */
  readonly log: readonly Message[];
  /** The message starts a session, whose Brief carries the record. */
  readonly newSession: boolean;
}

/**
 * The Open page whose record the session is given with the message, or undefined: none when the
 * message mentions it already, and none when a running or resumed session was given the same with
 * the previous message (a fresh session's Brief always carries it), so a long chat on one page
 * doesn't pay for the record on every message.
 */
export function openPageToGive({
  openPage,
  mentions,
  log,
  newSession,
}: OpenPageGiving): OpenPage | undefined {
  if (!openPage || mentions.some((mention) => isMentioned(openPage, mention))) return undefined;
  if (newSession) return openPage;
  const given = previousOpenPageInSession(log);
  return given && sameOpenPage(given, openPage) ? undefined : openPage;
}

/** Whether two Open pages are the same record's. */
export function sameOpenPage(one: OpenPage, other: OpenPage): boolean {
  return openPageKey(one) === openPageKey(other);
}

/**
 * The Open page the user's previous message in the current session was sent with: its log back to
 * the line of the move that started the session. Undefined when it had none, or there was none.
 */
function previousOpenPageInSession(log: readonly Message[]): OpenPage | undefined {
  for (const message of log.toReversed()) {
    if (message.kind === "user") return message.openPage;
    if (message.kind === "context" && message.move !== "resume") return undefined;
  }
  return undefined;
}

function isMentioned(page: OpenPage, mention: Mention): boolean {
  switch (mention.kind) {
    case "task":
      return page.kind === "task" && page.taskId === mention.taskId;
    case "initiative":
      return page.kind === "initiative" && page.initiativeId === mention.initiativeId;
    case "idea":
      return page.kind === "idea" && page.ideaId === mention.ideaId;
    case "decision":
      return false;
  }
}

/** The Brief of a session that starts on the message, carrying the Open page's record last. */
export function briefWithOpenPageRecord(brief: Brief, record: OpenPageRecord | undefined): Brief {
  if (!record) return brief;
  const text = withOpenPageRecord(brief.text, record);
  return { text, tokens: estimatedTokens(text) };
}

/** The Open page's record under its own heading, after the message and its Mentions. */
export function withOpenPageRecord(text: string, record: OpenPageRecord | undefined): string {
  if (!record) return text;
  return `${text}\n\n## The page the user has open\n\n${record.text ?? goneWords(record.page)}`;
}

function openPageKey(page: OpenPage): string {
  switch (page.kind) {
    case "task":
      return `task:${page.taskId}`;
    case "initiative":
      return `initiative:${page.initiativeId}`;
    case "idea":
      return `idea:${page.ideaId}`;
    case "person":
      return `person:${page.roleKey}`;
    case "project":
      return `project:${page.projectId}`;
  }
}

function goneWords(page: OpenPage): string {
  switch (page.kind) {
    case "task":
      return `The Office has no Task ${page.taskId}.`;
    case "initiative":
      return `The Office has no Initiative ${page.initiativeId}.`;
    case "idea":
      return `The Office has no Idea ${page.ideaId}.`;
    case "person":
      return `The Office has no Role ${page.roleKey}.`;
    case "project":
      return `The Office has no Project ${page.projectId}.`;
  }
}
