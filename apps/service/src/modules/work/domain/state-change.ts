import { authorWords, type Author, type UserRef } from "./author.js";
import type { DropReason } from "./drop-reason.js";
import type { TaskState } from "./task.js";

/** A part of a Task that auto mode confirmed on the user's behalf, the Pipeline by its id. */
export type AutoModeConfirmation =
  | { readonly part: "plan" }
  | { readonly part: "definition-of-done" }
  | { readonly part: "pipeline"; readonly pipelineId: string };

/** What a reset of the Task's branch did: the branch it was reset to and the ref keeping its old head. */
export interface BranchReset {
  readonly resetTo: string;
  readonly keptRef: string | null;
}

/**
 * The user's way back that made a move (spec 2.1.3, "Work moves forward"), with what the History
 * names: Restart from… a Stage, Start over (with the branch reset, or null when it wasn't), and
 * Reopen… of a Dropped Task, with the reason it was dropped (kept here, as the Task's head no
 * longer holds it) and the Start over it made of a Task that had started (null for none).
 */
export type WayBackStep =
  | { readonly kind: "restart"; readonly stageName: string }
  | { readonly kind: "start-over"; readonly branchReset: BranchReset | null }
  | {
      readonly kind: "reopen";
      readonly droppedAs: DropReason | null;
      readonly startedOver: { readonly branchReset: BranchReset | null } | null;
    };

/**
 * A move the user made by a way back: an Author's cause with the step, which a release that
 * doesn't know `wayBack` reads as the user alone.
 */
export interface UserWayBack {
  readonly kind: "user";
  readonly user: UserRef;
  readonly wayBack: WayBackStep;
}

/** A person as an Author: the Role they fill, and the users who asked for and allowed what they did. */
export type PersonAuthor = Extract<Author, { readonly kind: "person" }>;

/**
 * A move a person made by a way back, at a user's request: their Author's cause with the step,
 * which a release that doesn't know `wayBack` reads as the person alone.
 */
export type PersonWayBack = PersonAuthor & { readonly wayBack: WayBackStep };

/**
 * A way back as the cause of the move it makes: the user's own, or, when `person` took it as an
 * Office action, the person's, the user being the one who asked them.
 */
export function byWayBack(
  user: UserRef,
  wayBack: WayBackStep,
  person?: PersonAuthor,
): UserWayBack | PersonWayBack {
  return person ? { ...person, wayBack } : { kind: "user", user, wayBack };
}

/**
 * Who or what moved a Task between states: the user, or a person, as an Author, either by a way
 * back with its step; its Pipeline, as a
 * Stage waits on the user, completes or drops it; the fire alarm; the queue, starting it as its turn
 * came, with who queued it (null for a start kept before that was); its engine's usage window, used up or reset; auto mode, marking it Ready with what it confirmed first; or The Office itself, for the
 * reason it gives.
 */
export type StateChangeCause =
  | Author
  | UserWayBack
  | PersonWayBack
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

/** Who or what made a state change, as a record names them after "by". */
export function stateChangeCauseWords(cause: StateChangeCause): string {
  switch (cause.kind) {
    case "user":
    case "person":
      return "wayBack" in cause
        ? `${authorWords(cause)}: ${wayBackWords(cause.wayBack)}`
        : authorWords(cause);
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

/** What the way back did, as the History names it after who did it. */
export function wayBackWords(step: WayBackStep): string {
  switch (step.kind) {
    case "restart":
      return `Restarted from ${step.stageName}`;
    case "start-over":
      return `Started over${branchResetWords(step.branchReset)}`;
    case "reopen": {
      const dropped = step.droppedAs ? ` (dropped as ${droppedAsWords(step.droppedAs)})` : "";
      const startedOver = step.startedOver
        ? ` and started over${branchResetWords(step.startedOver.branchReset)}`
        : "";
      return `Reopened${dropped}${startedOver}`;
    }
  }
}

function branchResetWords(reset: BranchReset | null): string {
  if (!reset) return "";
  const kept = reset.keptRef === null ? "" : `, its old head kept under ${reset.keptRef}`;
  return `, its branch reset to ${reset.resetTo}${kept}`;
}

function droppedAsWords(reason: DropReason): string {
  switch (reason.kind) {
    case "wont-fix":
      return "Won't fix";
    case "cant-reproduce":
      return "Can't reproduce";
    case "duplicate":
      return `a duplicate of ${reason.taskId}`;
    case "other":
      return `"${reason.text}"`;
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
