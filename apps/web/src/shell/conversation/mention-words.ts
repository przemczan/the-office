import { recordPath, type Decision, type Idea, type Task } from "@the-office/contracts";

/** The kinds of record a message can mention, in the UI's words. */
export const MENTION_KINDS = {
  task: { word: "Task", icon: "square-check-big" },
  initiative: { word: "Initiative", icon: "flag" },
  decision: { word: "Decision", icon: "circle-help" },
  idea: { word: "Idea", icon: "lightbulb" },
} as const;

export type MentionKind = keyof typeof MENTION_KINDS;

/** A record the `@` picker offers: its kind, the words it shows, and the link it writes. */
export interface Mentionable {
  readonly kind: MentionKind;
  readonly label: string;
  readonly path: string;
}

/** The `@` being typed before the caret: where it starts, and what follows it so far. */
export interface MentionQuery {
  readonly start: number;
  readonly query: string;
}

/** How many records the picker shows at once (prototypes/app/conversation.js). */
export const MENTIONS_SHOWN = 8;

/**
 * The `@` the user is typing at the caret, if any: one at the start or after a space, followed by
 * up to 40 characters on the same line.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | undefined {
  const match = /(?:^|\s)@([^@\n]{0,40})$/.exec(text.slice(0, caret));
  if (!match) return undefined;
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, query };
}

/** The Tasks, open Decisions and Ideas a message can mention; dropped ones are left out. */
export function mentionables(
  tasks: readonly Task[],
  decisions: readonly Decision[],
  ideas: readonly Idea[],
): Mentionable[] {
  const titleOf = (taskId: string): string =>
    tasks.find(({ id }) => id === taskId)?.title ?? "a Task";
  return [
    ...tasks
      .filter(({ state }) => state !== "dropped")
      .map(({ id, title }) => ({
        kind: "task" as const,
        label: title,
        path: recordPath({ kind: "task", taskId: id }),
      })),
    ...decisions.map(({ id, taskId, threadId }) => ({
      kind: "decision" as const,
      label: `Decision on ${titleOf(taskId)}`,
      path: recordPath({ kind: "decision", taskId, threadId, decisionId: id }),
    })),
    ...ideas
      .filter(({ state }) => state !== "dropped")
      .map(({ id, title }) => ({
        kind: "idea" as const,
        label: title,
        path: recordPath({ kind: "idea", ideaId: id }),
      })),
  ];
}

/** The records whose words hold the query, or whose kind starts with it. */
export function matchingMentionables(
  records: readonly Mentionable[],
  query: string,
): Mentionable[] {
  const words = query.trim().toLowerCase();
  return records
    .filter(
      ({ kind, label }) =>
        label.toLowerCase().includes(words) ||
        MENTION_KINDS[kind].word.toLowerCase().startsWith(words),
    )
    .slice(0, MENTIONS_SHOWN);
}

/**
 * The message as sent: each record picked with `@` and still in the text becomes a Markdown link to
 * its page, which The Office reads as a mention.
 */
export function withMentionLinks(draft: string, picked: readonly Mentionable[]): string {
  if (picked.length === 0) return draft;
  const pathOf = new Map(picked.map(({ label, path }) => [label, path]));
  // One pass, the longest label first, so a label inside another's is never linked in its place.
  const labels = [...pathOf.keys()].toSorted((first, second) => second.length - first.length);
  const pattern = new RegExp(`@(${labels.map(escapedForPattern).join("|")})`, "g");
  return draft.replace(
    pattern,
    (_, label: string) => `[@${escapedForMarkdown(label)}](${pathOf.get(label) ?? ""})`,
  );
}

function escapedForPattern(label: string): string {
  return label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapedForMarkdown(label: string): string {
  return label.replace(/[\\[\]]/g, "\\$&");
}
