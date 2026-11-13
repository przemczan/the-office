import { authorWords, type Author, type UserRef } from "./author.js";
import type { TaskState } from "./task.js";
import { TASK_STATE_NAMES } from "./task-states.js";

/** A part of a Task that auto mode confirmed on the user's behalf, the Pipeline by its id. */
export type AutoModeConfirmation =
  | { readonly part: "plan" }
  | { readonly part: "definition-of-done" }
  | { readonly part: "pipeline"; readonly pipelineId: string };

/**
 * Who or what moved a Task between states: the user, or a person, as an Author; its Pipeline, as a
 * Stage waits on the user, completes or drops it; the fire alarm; the queue, starting it as its turn
 * came, with who queued it (null for a start kept before that was); its engine's usage window, used up or reset; auto mode, marking it Ready with what it confirmed first; or The Office itself, for the
 * reason it gives.
 */
export type StateChangeCause =
  | Author
  | { readonly kind: "pipeline" }
  | { readonly kind: "fire-alarm" }
  | { readonly kind: "queue"; readonly queuedBy: Author | null }
  | { readonly kind: "usage-window" }
  | { readonly kind: "auto-mode"; readonly confirmed: readonly AutoModeConfirmation[] }
  | { readonly kind: "office"; readonly reason: string };

export const BY_THE_PIPELINE: StateChangeCause = { kind: "pipeline" };
export const BY_THE_FIRE_ALARM: StateChangeCause = { kind: "fire-alarm" };
export const BY_THE_USAGE_WINDOW: StateChangeCause = { kind: "usage-window" };

/** The user who made the change, for one a user made since users exist; undefined for any other. */
export function userBehind(cause: StateChangeCause): UserRef | undefined {
  return cause.kind === "user" ? (cause.user ?? undefined) : undefined;
}

/**
 * A Task's move from one state to another, kept with the Task for its record (problem J of task
 * 30). `from` is undefined for the Task's creation, which starts its kept history.
 */
export interface StateChange {
  readonly from: TaskState | undefined;
  readonly to: TaskState;
  readonly at: Date;
  readonly by: StateChangeCause;
}

/** The record's lines for the Task's state changes, oldest first, as an Agent reads them. */
export function stateChangeLines(changes: readonly StateChange[]): string[] {
  const first = changes[0];
  const keptFromCreation = first !== undefined && first.from === undefined;
  return [
    keptFromCreation
      ? "State changes:"
      : "State changes since The Office began keeping them (earlier ones weren't kept):",
    ...(changes.length === 0 ? ["None kept yet."] : changes.map(stateChangeLine)),
  ];
}

function stateChangeLine({ from, to, at, by }: StateChange): string {
  const move =
    from === undefined
      ? `created in ${TASK_STATE_NAMES[to]}`
      : `${TASK_STATE_NAMES[from]} → ${TASK_STATE_NAMES[to]}`;
  return `- ${at.toISOString()}: ${move}, by ${stateChangeCauseWords(by)}`;
}

/** Who or what made a state change, as a record names them after "by". */
export function stateChangeCauseWords(cause: StateChangeCause): string {
  switch (cause.kind) {
    case "user":
    case "person":
      return authorWords(cause);
    case "pipeline":
      return "its Pipeline";
    case "fire-alarm":
      return "the fire alarm";
    case "queue":
      return cause.queuedBy
        ? `the queue, as its turn came (queued by ${authorWords(cause.queuedBy)})`
        : "the queue, as its turn came";
    case "usage-window":
      return "its engine's usage window";
    case "auto-mode":
      return autoModeWords(cause.confirmed);
    case "office":
      return `The Office: ${cause.reason}`;
  }
}

function autoModeWords(confirmed: readonly AutoModeConfirmation[]): string {
  if (confirmed.length === 0) return "auto mode";
  return `auto mode, which confirmed ${listWords(confirmed.map(confirmationWords))}`;
}

function confirmationWords(confirmation: AutoModeConfirmation): string {
  switch (confirmation.part) {
    case "plan":
      return "the Plan";
    case "definition-of-done":
      return "the Definition of Done";
    case "pipeline":
      return `the Pipeline ${confirmation.pipelineId}`;
  }
}

function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}
