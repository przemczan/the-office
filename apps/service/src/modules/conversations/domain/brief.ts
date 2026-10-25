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

/** Characters per token, the usual estimate for English text and code. */
const CHARACTERS_PER_TOKEN = 4;

export function estimatedTokens(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN);
}

/** A new chat Thread's Brief: where the Projects are, before the user's first message. */
export function newChatThreadBrief(projects: readonly BriefProject[]): Brief {
  return briefOf([
    "You are talking with the user in your chat, in a new Thread: nothing from your earlier Threads carries over.",
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
}: {
  readonly title: string | undefined;
  /** The Thread's log so far, oldest first. */
  readonly log: readonly Message[];
  readonly projects: readonly BriefProject[];
}): Brief {
  const note = log.findLast((message) => message.kind === "handover-note");
  return briefOf([
    "You are continuing a Thread with the user in your chat, in a fresh session: the earlier session's context is gone, and this Brief is what you pick up from.",
    title === undefined ? undefined : `## The Thread\n\n${title}`,
    note && `## Your Handover note\n\n${note.text}`,
    exchangesSection(log),
    projectsSection(projects),
  ]);
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
