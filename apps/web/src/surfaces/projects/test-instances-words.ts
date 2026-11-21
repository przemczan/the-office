import type { ProjectBranches, ProjectTestInstances } from "@the-office/contracts";

/** The branches the Branch picker offers: the base branch, then the others by name. */
export interface BranchChoices {
  readonly baseBranch: string;
  readonly others: readonly string[];
}

/**
 * The base branch first, then every other branch by name: a remote one by its name on the remote
 * ("origin/feature" as "feature"), each once; those launched on are offered before the list is
 * read, as is the branch picked.
 */
export function branchChoicesOf(
  baseBranch: string,
  known: ProjectBranches | undefined,
  launchedOn: readonly string[],
): BranchChoices {
  const base = known?.baseBranch.name ?? baseBranch;
  const names = [
    ...(known?.branches ?? []).map(({ name, kind }) =>
      kind === "remote" ? name.slice(name.indexOf("/") + 1) : name,
    ),
    ...launchedOn,
  ];
  const others = [...new Set(names)]
    .filter((name) => name !== base && name !== "" && name !== "HEAD")
    .toSorted((first, second) => first.localeCompare(second));
  return { baseBranch: base, others };
}

/** The branch shown at first: the one launched on last, else the base branch. */
export function firstBranchOf(shown: ProjectTestInstances, baseBranch: string): string {
  return shown.branches.find(({ instances }) => instances.length > 0)?.name ?? baseBranch;
}

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
