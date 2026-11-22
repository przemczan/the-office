import type { OffBoardTask, OffBoardTaskKind } from "@the-office/contracts";

/** Where an Off-board Task of each kind is followed on its Project's page. */
export const OFF_BOARD_TASK_PLACE = {
  onboard: "/projects/$projectId",
  "run-environment-setup": "/projects/$projectId/run-environment",
} as const satisfies Record<OffBoardTaskKind, string>;

/** The Task page's note on an Off-board Task, around the link to its Project's page. */
export const OFF_BOARD_NOTE_BEFORE =
  "The Office started this Off-board Task at once and keeps it off the Work board. Follow it here or on ";

/** The link's words: "<Project>'s page". */
export function projectPageWords(projectName: string): string {
  return `${projectName}’s page`;
}

/**
 * The hint under the run environment question's Yes: with a Project limit of 1, the Task asked on
 * queues behind the Off-board Task Yes starts.
 */
export function setUpHintWords(projectName: string, projectLimit: number): string {
  const slot = `Yes starts an Off-board Task at once, off the board. It takes one of ${projectName}’s running slots while it runs`;
  return projectLimit === 1
    ? `${slot}, so with a Project limit of 1 this Task’s Start queues behind it.`
    : `${slot}.`;
}

/** After Yes: who sets the run environment up, or where the Off-board Task waits. */
export function settingUpWords(offBoardTask: OffBoardTask, projectName: string): string {
  const { status, person, title } = offBoardTask;
  if (status.state === "queued") {
    const reasons = status.shortReasons.length > 0 ? `: ${status.shortReasons.join(", ")}` : "";
    return `${title} is queued, place ${status.place}${reasons}.`;
  }
  return `${person?.name ?? "The Office"} is setting up ${projectName}’s run environment.`;
}

/** The link after it, to the Project page's Run environment. */
export const FOLLOW_IT_ON = "Follow it on ";

export function runEnvironmentLinkWords(projectName: string): string {
  return `${projectName}’s Run environment`;
}

export const TURNS_ON_WHEN_DONE = ". It turns On when the Off-board Task is Done.";

/** Yes refused: no Off-board Task was made. */
export const SET_UP_REFUSED = "The run environment's set-up didn't start";
