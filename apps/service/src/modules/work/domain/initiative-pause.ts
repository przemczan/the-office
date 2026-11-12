import type { Initiative } from "./initiative.js";
import type { InitiativeTasksChange } from "./initiative-changes.js";
import { InitiativePaused, InitiativeResumed } from "./initiative-events.js";
import { InitiativeRefused } from "./initiative-refused.js";
import type { Task } from "./task.js";
import { pauseTaskForInitiative, resumeTaskForInitiative } from "./task-changes.js";

// Pause the Initiative and Resume the Initiative (spec §2.1): the fire alarm's design (spec §2.8),
// scoped to one Initiative. The mark is beside its state, as the Archive's is.

/** Why a Start, Start Ready Tasks or a turn in the queue waits for a Task of a paused Initiative. */
export const INITIATIVE_PAUSED = "The Initiative is paused.";

/** Whether the Initiative is paused: a mark beside its state, never a state. */
export function isInitiativePaused(initiative: Pick<Initiative, "pausedAt">): boolean {
  return initiative.pausedAt !== undefined;
}

/**
 * Pause the Initiative: marks an active one paused and pauses each of its Tasks In progress or
 * Waiting on you, taking over those the fire alarm holds (pauseTaskForInitiative). Refused with the
 * reason for one that isn't active or is paused already.
 */
export function pauseInitiative(
  initiative: Initiative,
  tasks: readonly Task[],
  at: Date,
): InitiativeTasksChange<InitiativePaused> {
  if (initiative.state !== "active") {
    throw new InitiativeRefused([
      `Only an active Initiative can be paused; this one is ${initiative.state}.`,
    ]);
  }
  if (isInitiativePaused(initiative)) {
    throw new InitiativeRefused(["The Initiative is paused already."]);
  }
  return {
    initiative: { ...initiative, pausedAt: at },
    event: new InitiativePaused(initiative.id, at),
    taskChanges: tasks.flatMap((task) => pauseTaskForInitiative(task) ?? []),
  };
}

/**
 * Resume the Initiative: clears the mark and resumes each Task its Pause held, which the fire alarm
 * holds instead while it is on (resumeTaskForInitiative); a Task the user paused stays Paused.
 * Refused with the reason for one that isn't paused.
 */
export function resumeInitiative(
  initiative: Initiative,
  tasks: readonly Task[],
  { fireAlarmOn }: { readonly fireAlarmOn: boolean },
): InitiativeTasksChange<InitiativeResumed> {
  if (!isInitiativePaused(initiative)) {
    throw new InitiativeRefused([
      "Only a paused Initiative can be resumed; this one isn't paused.",
    ]);
  }
  return {
    initiative: { ...initiative, pausedAt: undefined },
    event: new InitiativeResumed(initiative.id),
    taskChanges: tasks.flatMap((task) => resumeTaskForInitiative(task, { fireAlarmOn }) ?? []),
  };
}
