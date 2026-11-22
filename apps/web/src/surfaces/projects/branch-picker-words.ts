import type { Initiative, ProjectBranches, TaskSummary } from "@the-office/contracts";

/**
 * What the Branch picker chose: a branch, or a Task or an Initiative, each meaning its branch
 * (spec 2.15 "What it runs from"). Whatever runs on it runs on `branch`.
 */
export type BranchChoice =
  | { readonly kind: "branch"; readonly branch: string }
  | { readonly kind: "task"; readonly taskId: string; readonly branch: string }
  | { readonly kind: "initiative"; readonly initiativeId: string; readonly branch: string };

/** The branches the Branch picker offers: the base branch, then the others by name. */
export interface BranchChoices {
  readonly baseBranch: string;
  readonly others: readonly string[];
}

/** A Task's own branch, `office/<task id>`, as The Office names it (spec 5.5). */
export function taskBranchOf(taskId: string): string {
  return `office/${taskId}`;
}

/** A branch by its own name: a remote one's without its remote ("origin/feature" as "feature"). */
function ownNameOf({ name, kind }: ProjectBranches["branches"][number]): string {
  return kind === "remote" ? name.slice(name.indexOf("/") + 1) : name;
}

/**
 * The base branch first, then every other branch by name: a remote one by its name on the remote,
 * each once; `alsoOffer` (such as those launched on, or the branch chosen) is offered before the
 * list is read.
 */
export function branchChoicesOf(
  baseBranch: string,
  known: ProjectBranches | undefined,
  alsoOffer: readonly string[],
): BranchChoices {
  const base = known?.baseBranch.name ?? baseBranch;
  const names = [...(known?.branches ?? []).map(ownNameOf), ...alsoOffer];
  const others = [...new Set(names)]
    .filter((name) => name !== base && name !== "" && name !== "HEAD")
    .toSorted((first, second) => first.localeCompare(second));
  return { baseBranch: base, others };
}

/** An Initiative the picker offers, with the branch it means in the Project. */
export interface InitiativeChoice {
  readonly initiativeId: string;
  readonly name: string;
  readonly branch: string;
}

/** The active Initiatives with a branch in the Project, by name. */
export function initiativeChoicesOf(
  initiatives: readonly Initiative[] | undefined,
  projectId: string,
): InitiativeChoice[] {
  return (initiatives ?? [])
    .filter(({ state }) => state === "active")
    .flatMap(({ id, name, branches }) => {
      const made = branches.find((branch) => branch.projectId === projectId);
      return made === undefined ? [] : [{ initiativeId: id, name, branch: made.branch }];
    })
    .toSorted((first, second) => first.name.localeCompare(second.name));
}

/** A Task the picker offers, with its branch. */
export interface TaskChoice {
  readonly taskId: string;
  readonly title: string;
  readonly branch: string;
}

/**
 * The Project's Tasks, not Done or Dropped, whose `office/<task id>` branch the repository or its
 * remote has, by title: a Task has one once it first started, and a Publishing Task holds its
 * Initiative's branch instead, which the Initiatives offer.
 */
export function taskChoicesOf(
  tasks: readonly TaskSummary[] | undefined,
  known: ProjectBranches | undefined,
  projectId: string,
): TaskChoice[] {
  const branches = new Set((known?.branches ?? []).map(ownNameOf));
  return (tasks ?? [])
    .filter(
      ({ id, projectId: itsProject, state }) =>
        itsProject === projectId &&
        state !== "done" &&
        state !== "dropped" &&
        branches.has(taskBranchOf(id)),
    )
    .map(({ id, title }) => ({ taskId: id, title, branch: taskBranchOf(id) }))
    .toSorted((first, second) => first.title.localeCompare(second.title));
}

/** The picker's value for a choice: its kind and what it names, unique across the groups. */
export function choiceValueOf(choice: BranchChoice): string {
  switch (choice.kind) {
    case "branch":
      return `branch:${choice.branch}`;
    case "task":
      return `task:${choice.taskId}`;
    case "initiative":
      return `initiative:${choice.initiativeId}`;
  }
}

/** The groups' names, in their order. */
export const BRANCH_PICKER_GROUPS = {
  branches: "Branches",
  initiatives: "Initiatives",
  tasks: "Tasks",
} as const;

/** While the branches are read. */
export const FETCHING_BRANCHES = "Fetching branches…";

/** What the list says when nothing matches the words typed. */
export const NO_BRANCH_MATCHES = "No branch, Initiative or Task matches.";

/** On hover over a Task's choice. */
export const TASK_BRANCH_NOTE =
  "Its branch as last committed: work not committed in its worktree isn't in it.";

/** When the remote couldn't be fetched, so the branches are those last known here. */
export function fetchProblemWords(fetchProblem: string): string {
  return `The branches couldn't be fetched, so some may be missing: ${fetchProblem}`;
}
