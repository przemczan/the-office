/** The card's note under its title. */
export const TEST_INSTANCES_NOTE =
  "Launch a test target on any branch. One launched on an active Initiative's branch shows on its page too.";

/** With no Hosted or Build to install test target to launch. */
export function nothingToLaunchWords(projectName: string): string {
  return `${projectName} has no Hosted or Build to install test targets yet.`;
}

/** Under the card's rows. */
export const LAUNCH_FOOT =
  "Each launch runs the branch's tip, fetched first, on its own checkout and data.";

/** Over the groups of the branches other than the one picked. */
export const OTHER_BRANCHES = "Other branches";
