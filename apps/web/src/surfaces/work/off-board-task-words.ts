import type { OffBoardTaskKind } from "@the-office/contracts";

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
