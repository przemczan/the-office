import { answerWords, type Decision } from "./decision.js";
import type { Message } from "./message.js";

/**
 * What a new session is given to pick up work (spec §2.5), assembled from the record with no model
 * call: never a transcript.
 */
export interface Brief {
  readonly text: string;
  /** Estimated, for the Thread's label and the Context policy's costs. */
  readonly tokens: number;
}

/**
 * A Project as a session reads it, checked out read-only: its base branch, or on an Initiative, the
 * Initiative's branch.
 */
export interface BriefProject {
  readonly projectId: string;
  readonly name: string;
  readonly baseBranch: string;
  /** Where the session reads it. */
  readonly folder: string;
  /**
   * The Initiative's branch a session on an Initiative reads in this Project, `gone` once it was
   * deleted here, so the base branch is read instead; undefined where it reads the base branch.
   */
  readonly initiativeBranch?: { readonly branch: string; readonly gone: boolean };
}

/** About as much of a chat Thread's log as a Brief carries (spec §9). */
export const CHAT_EXCHANGES_TOKENS = 3_000;

/** About as much of a person's Memory as a Brief carries (spec 2.2). */
export const MEMORY_TOKENS = 2_000;

/** Characters per token, the usual estimate for English text and code. */
const CHARACTERS_PER_TOKEN = 4;

export function estimatedTokens(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN);
}

/** A Memory note as a Brief reads it. */
export interface BriefMemoryNote {
  readonly text: string;
  /** The Project the note is about; undefined when it holds for all of them. */
  readonly projectId: string | undefined;
  readonly writtenAt: Date;
}

/** The part of a person's Memory a Brief carries: the notes that fit, oldest first. */
export interface BriefMemory {
  readonly lines: readonly string[];
  /** How many older notes the cap left out. */
  readonly leftOut: number;
}

export const NO_MEMORY: BriefMemory = { lines: [], leftOut: 0 };

/**
 * Which of a person's notes a Brief reads: on a Task, those for all Projects and its Project's; on
 * an Initiative, those for all Projects; in a chat, which reads every Project, every note, each
 * labelled with what it is about.
 */
export type MemoryReach =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "all-projects" }
  | { readonly kind: "every-note"; readonly projects: readonly BriefProject[] };

/** The label the Memory tab groups a note for all Projects under. */
const ALL_PROJECTS = "All Projects";

/**
 * The notes `reach` reads, the newest that fit under the cap: older ones are dropped, never
 * summarised, since no model call builds a Brief.
 */
export function selectMemory(notes: readonly BriefMemoryNote[], reach: MemoryReach): BriefMemory {
  const relevant = notes
    .filter((note) => isInReach(note, reach))
    .toSorted((first, second) => second.writtenAt.getTime() - first.writtenAt.getTime());
  const lines: string[] = [];
  let room = MEMORY_TOKENS * CHARACTERS_PER_TOKEN;
  for (const note of relevant) {
    const line = `- ${note.writtenAt.toISOString().slice(0, 10)}${aboutLabel(note, reach)}: ${note.text}`;
    if (line.length > room) break;
    lines.push(line);
    room -= line.length;
  }
  return { lines: lines.toReversed(), leftOut: relevant.length - lines.length };
}

function isInReach(note: BriefMemoryNote, reach: MemoryReach): boolean {
  switch (reach.kind) {
    case "every-note":
      return true;
    case "all-projects":
      return note.projectId === undefined;
    case "project":
      return note.projectId === undefined || note.projectId === reach.projectId;
  }
}

/** What the note is about, where a Brief reads the notes of more than one Project. */
function aboutLabel(note: BriefMemoryNote, reach: MemoryReach): string {
  if (reach.kind !== "every-note") return "";
  if (note.projectId === undefined) return ` (${ALL_PROJECTS})`;
  const project = reach.projects.find(({ projectId }) => projectId === note.projectId);
  return ` (${project?.name ?? note.projectId})`;
}

/**
 * A new chat Thread's Brief: your Memory and where the Projects are, before the user's first
 * message.
 */
export function newChatThreadBrief(projects: readonly BriefProject[], memory: BriefMemory): Brief {
  return briefOf([
    "You are talking with the user in your chat, in a new Thread: nothing from your earlier Threads carries over.",
    memorySection(memory),
    projectsSection(projects),
  ]);
}

/**
 * A chat Thread's Brief when it continues in a fresh session (spec §9): its title, the person's
 * latest Handover note, and its last exchanges, newest kept, capped at about 3k tokens.
 */
export function freshChatThreadBrief({
  title,
  log,
  projects,
  memory,
}: {
  readonly title: string | undefined;
  /** The Thread's log so far, oldest first. */
  readonly log: readonly Message[];
  readonly projects: readonly BriefProject[];
  readonly memory: BriefMemory;
}): Brief {
  const note = log.findLast((message) => message.kind === "handover-note");
  return briefOf([
    "You are continuing a Thread with the user in your chat, in a fresh session: the earlier session's context is gone, and this Brief is what you pick up from.",
    title === undefined ? undefined : `## The Thread\n\n${title}`,
    note && `## Your Handover note\n\n${note.text}`,
    exchangesSection(log),
    memorySection(memory),
    projectsSection(projects),
  ]);
}

/**
 * A person's Thread on a Task's Brief when it continues in a fresh session (spec §2.5): as a chat's,
 * from the Thread alone. The record was the first session's, and the session reads the Task's
 * worktree, so no Project is listed.
 */
export function freshPersonsThreadBrief({
  title,
  log,
  memory,
}: {
  readonly title: string | undefined;
  /** The Thread's log so far, oldest first. */
  readonly log: readonly Message[];
  readonly memory: BriefMemory;
}): Brief {
  const note = log.findLast((message) => message.kind === "handover-note");
  return briefOf([
    "You are continuing your Thread on a Task with the user, in a fresh session: the earlier session's context is gone, and this Brief is what you pick up from. You read the Task's worktree and change nothing in it.",
    title === undefined ? undefined : `## The Thread\n\n${title}`,
    note && `## Your Handover note\n\n${note.text}`,
    exchangesSection(log),
    memorySection(memory),
  ]);
}

/** What a Brief for a Thread on a Task is assembled from. */
export interface TaskThreadRecord {
  /** The Task's record, as the module keeping Tasks words it. */
  readonly record: string;
  /** The Thread continues in a fresh session, after one before it. */
  readonly continuing: boolean;
  /** The Decisions on the Task the user answered, in any of its Threads, in the order answered. */
  readonly answered: readonly Decision[];
  /** The Decision this Thread waits on the user for, if any. */
  readonly open: Decision | undefined;
  /** The person's Memory notes for the Task's Project. */
  readonly memory: BriefMemory;
}

/**
 * A Brief for a Thread on a Task: the Task's record, its answered Decisions and the one the Thread
 * waits on, and, when the Thread continues in a fresh session, that the earlier context is gone.
 * Unlike a chat's, it carries none of the Thread's exchanges: a Task's record holds what was
 * settled (spec §2.5).
 */
export function taskThreadBrief({
  record,
  continuing,
  answered,
  open,
  memory,
}: TaskThreadRecord): Brief {
  return briefOf([
    continuing
      ? "You are continuing a Thread on a Task in a fresh session: the earlier session's context is gone, and this Brief, from the Task's record, is what you pick up from."
      : undefined,
    record,
    memorySection(memory),
    answeredSection(answered),
    open && openSection(open),
  ]);
}

/** What a Brief for a Thread on an Initiative is assembled from. */
export interface InitiativeThreadRecord {
  /** The Initiative's record, as the module keeping Initiatives words it. */
  readonly record: string;
  /** The Thread continues in a fresh session, after one before it. */
  readonly continuing: boolean;
  /** The person's Memory notes that hold for every Project, since an Initiative spans them. */
  readonly memory: BriefMemory;
  readonly projects: readonly BriefProject[];
}

/**
 * A Brief for a Thread on an Initiative: its record and where the Projects are, and, when the
 * Thread continues in a fresh session, that the earlier context is gone. Like a Task's, it carries
 * none of the Thread's exchanges: what was settled is on the Initiative (spec §2.5).
 */
export function initiativeThreadBrief({
  record,
  continuing,
  memory,
  projects,
}: InitiativeThreadRecord): Brief {
  return briefOf([
    continuing
      ? "You are continuing a Thread on an Initiative in a fresh session: the earlier session's context is gone, and this Brief, from the Initiative's record, is what you pick up from."
      : undefined,
    record,
    memorySection(memory),
    projectsSection(projects),
  ]);
}

function memorySection({ lines, leftOut }: BriefMemory): string | undefined {
  if (lines.length === 0 && leftOut === 0) return undefined;
  const omitted =
    leftOut === 0 ? "" : `\n\n${leftOut} older ${leftOut === 1 ? "note" : "notes"} left out.`;
  return `## Your Memory\n\nNotes you wrote in earlier sessions, oldest first:\n\n${lines.join("\n")}${omitted}`;
}

function answeredSection(decisions: readonly Decision[]): string | undefined {
  const lines = decisions.flatMap((decision) =>
    decision.answer
      ? [`- ${decision.question}\n  Answer: ${answerWords(decision, decision.answer)}`]
      : [],
  );
  if (lines.length === 0) return undefined;
  return `## Decisions the user answered\n\n${lines.join("\n")}`;
}

function openSection({ question, options }: Decision): string {
  const listed = options.map((option) => `- ${option}`).join("\n");
  return `## Your open Decision\n\nYou asked the user "${question}", with the options:\n\n${listed}\n\nThey haven't answered it yet: their answer comes as a message in this Thread.`;
}

function briefOf(sections: readonly (string | undefined)[]): Brief {
  const text = sections.filter((section) => section !== undefined).join("\n\n");
  return { text, tokens: estimatedTokens(text) };
}

function projectsSection(projects: readonly BriefProject[]): string {
  if (projects.length === 0) return "## The Projects\n\nThe Office works on no Project yet.";
  const heading = projects.some(({ initiativeBranch }) => initiativeBranch?.gone === false)
    ? "You read each Project where it is checked out:"
    : "You read each Project's base branch where it is checked out:";
  return `## The Projects\n\n${heading}\n\n${projects.map(projectLine).join("\n")}`;
}

function projectLine({ name, baseBranch, folder, initiativeBranch }: BriefProject): string {
  if (initiativeBranch?.gone === false) {
    return `- ${name}: the Initiative's branch ${initiativeBranch.branch}, read-only, at ${folder}`;
  }
  const base = `- ${name}: its ${baseBranch} branch, read-only, at ${folder}`;
  return initiativeBranch === undefined
    ? base
    : `${base}; the Initiative's branch ${initiativeBranch.branch} is gone, so you read the base branch.`;
}

/** The user's messages and the person's, the newest that fit under the cap, oldest first. */
function exchangesSection(log: readonly Message[]): string | undefined {
  const lines: string[] = [];
  let room = CHAT_EXCHANGES_TOKENS * CHARACTERS_PER_TOKEN;
  for (const message of log.toReversed()) {
    if (message.kind !== "user" && message.kind !== "person") continue;
    const line = `${message.kind === "user" ? "The user" : "You"}: ${message.text}`;
    if (line.length > room) {
      // The newest message alone over the cap keeps its end, which the conversation went on from.
      if (lines.length === 0) lines.push(`…${line.slice(line.length - room + 1)}`);
      break;
    }
    lines.push(line);
    room -= line.length;
  }
  if (lines.length === 0) return undefined;
  return `## The latest exchanges\n\n${lines.toReversed().join("\n\n")}`;
}
