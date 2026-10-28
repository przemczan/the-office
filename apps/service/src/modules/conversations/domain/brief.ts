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

/** A Project as a session reads it: its base branch, checked out read-only. */
export interface BriefProject {
  readonly name: string;
  readonly baseBranch: string;
  /** Where the session reads the base branch. */
  readonly folder: string;
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
 * The notes that hold for all Projects and those about `projectId`, the newest that fit under the
 * cap: older ones are dropped, never summarised, since no model call builds a Brief.
 */
export function selectMemory(
  notes: readonly BriefMemoryNote[],
  projectId: string | undefined,
): BriefMemory {
  const relevant = notes
    .filter((note) => note.projectId === undefined || note.projectId === projectId)
    .toSorted((first, second) => second.writtenAt.getTime() - first.writtenAt.getTime());
  const lines: string[] = [];
  let room = MEMORY_TOKENS * CHARACTERS_PER_TOKEN;
  for (const note of relevant) {
    const line = `- ${note.writtenAt.toISOString().slice(0, 10)}: ${note.text}`;
    if (line.length > room) break;
    lines.push(line);
    room -= line.length;
  }
  return { lines: lines.toReversed(), leftOut: relevant.length - lines.length };
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
  const lines = projects.map(
    ({ name, baseBranch, folder }) =>
      `- ${name}: its ${baseBranch} branch, read-only, at ${folder}`,
  );
  return `## The Projects\n\nYou read each Project's base branch where it is checked out:\n\n${lines.join("\n")}`;
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
