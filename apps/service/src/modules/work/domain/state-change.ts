import { authorWords, type Author } from "./author.js";
import type { TaskState } from "./task.js";
import { TASK_STATE_NAMES } from "./task-states.js";

/**
 * Who or what moved a Task between states: the user, or a person, as an Author; its Pipeline, as a
 * Stage waits on the user, completes or drops it; the fire alarm; the queue, starting it as its turn
 * came; or The Office itself, for the reason it gives.
 */
export type StateChangeCause =
  | Author
  | { readonly kind: "pipeline" }
  | { readonly kind: "fire-alarm" }
  | { readonly kind: "queue" }
  | { readonly kind: "office"; readonly reason: string };

export const BY_THE_PIPELINE: StateChangeCause = { kind: "pipeline" };
export const BY_THE_FIRE_ALARM: StateChangeCause = { kind: "fire-alarm" };
export const BY_THE_QUEUE: StateChangeCause = { kind: "queue" };

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
  return `- ${at.toISOString()}: ${move}, by ${causeWords(by)}`;
}

function causeWords(cause: StateChangeCause): string {
  switch (cause.kind) {
    case "user":
    case "person":
      return authorWords(cause);
    case "pipeline":
      return "its Pipeline";
    case "fire-alarm":
      return "the fire alarm";
    case "queue":
      return "the queue, as its turn came";
    case "office":
      return `The Office: ${cause.reason}`;
  }
}
