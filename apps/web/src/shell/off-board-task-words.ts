import type { OffBoardTask, OffBoardTaskKind, OffBoardTaskStart } from "@the-office/contracts";

/** What the person does while an Off-board Task of each kind runs, after their name. */
const DOING: Readonly<Record<OffBoardTaskKind, (projectName: string) => string>> = {
  onboard: (projectName) => `is onboarding ${projectName}`,
  "run-environment-setup": (projectName) => `is setting up ${projectName}'s run environment`,
};

/** "Place 2 in the queue". */
export function queuePlaceWords(place: number): string {
  return `Place ${place} in the queue`;
}

/**
 * The toast at the press of a button that starts an Off-board Task (Onboard, Set up run
 * environment): "Dwight is onboarding notnullsoft.", "Onboard is queued, place 2: Project limit
 * reached (1).", or the one already in flight. Undefined for a refusal, which shows under the
 * button instead.
 */
export function offBoardStartWords(
  start: OffBoardTaskStart,
  projectName: string,
): string | undefined {
  if (start.outcome === "refused") return undefined;
  const task = start.offBoardTask;
  if (start.outcome === "in-flight") return `${task.title} is already under way.`;
  return offBoardTaskWords(task, projectName);
}

function offBoardTaskWords(task: OffBoardTask, projectName: string): string {
  const { status } = task;
  if (status.state === "queued") {
    const reasons = status.shortReasons.length > 0 ? `: ${status.shortReasons.join(", ")}` : "";
    return `${task.title} is queued, place ${status.place}${reasons}.`;
  }
  if (task.person) return `${task.person.name} ${DOING[task.kind](projectName)}.`;
  return `${task.title} started.`;
}
