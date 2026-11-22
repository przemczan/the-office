import { useQuery } from "@tanstack/react-query";
import type { Project } from "@the-office/contracts";
import { Badge, SearchableSelect, type SearchableSelectOption } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, taskQueries } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import {
  BRANCH_PICKER_GROUPS,
  branchChoicesOf,
  choiceValueOf,
  FETCHING_BRANCHES,
  fetchProblemWords,
  initiativeChoicesOf,
  NO_BRANCH_MATCHES,
  TASK_BRANCH_NOTE,
  taskChoicesOf,
  type BranchChoice,
} from "./branch-picker-words.ts";

export type { BranchChoice } from "./branch-picker-words.ts";

/** As many as a Project has: the picker lists every match, in its groups. */
const EVERY_MATCH = Number.POSITIVE_INFINITY;

/**
 * The Branch picker (screens/project-page.md "The Branch picker"): what a test instance launches
 * on or an Action runs from, a searchable select of three groups searched together by name, title
 * and branch. Branches: the base branch first, badged, then the repository's and its remote's by
 * name. Initiatives: the active ones with a branch in the Project, by name. Tasks: the Project's
 * with a branch, not Done or Dropped, by title. The branches, Initiatives and Tasks are read only
 * once it is opened; until then it offers the base branch, `alsoOffer` and the choice.
 */
export function BranchPicker({
  project,
  value,
  onChange,
  alsoOffer = [],
  label = "Branch",
}: {
  readonly project: Project;
  /** The choice; none for the base branch, chosen until the user picks another. */
  readonly value?: BranchChoice;
  readonly onChange: (choice: BranchChoice) => void;
  /** Branches to offer before the list is read, such as those launched on. */
  readonly alsoOffer?: readonly string[];
  readonly label?: string;
}): ReactNode {
  const [opened, setOpened] = useState(false);
  const branches = useQuery({
    ...projectQueries.branches(project.id, { fetch: true }),
    enabled: opened,
  });
  const initiatives = useQuery({ ...initiativeQueries.list(), enabled: opened });
  const tasks = useQuery({ ...taskQueries.list(), enabled: opened });
  const known = branches.data;
  const choices = branchChoicesOf(project.baseBranch, known, [
    ...alsoOffer,
    ...(value?.kind === "branch" ? [value.branch] : []),
  ]);
  const chosen: BranchChoice = value ?? { kind: "branch", branch: choices.baseBranch };
  const offered: { readonly choice: BranchChoice; readonly option: SearchableSelectOption }[] = [
    {
      choice: { kind: "branch", branch: choices.baseBranch },
      option: {
        value: choiceValueOf({ kind: "branch", branch: choices.baseBranch }),
        label: choices.baseBranch,
        group: BRANCH_PICKER_GROUPS.branches,
        aside: <Badge tone="neutral">base branch</Badge>,
      },
    },
    ...choices.others.map((branch) => {
      const choice: BranchChoice = { kind: "branch", branch };
      return {
        choice,
        option: {
          value: choiceValueOf(choice),
          label: branch,
          group: BRANCH_PICKER_GROUPS.branches,
        },
      };
    }),
    ...initiativeChoicesOf(initiatives.data, project.id).map(({ initiativeId, name, branch }) => {
      const choice: BranchChoice = { kind: "initiative", initiativeId, branch };
      return {
        choice,
        option: {
          value: choiceValueOf(choice),
          label: name,
          alsoMatches: [branch],
          group: BRANCH_PICKER_GROUPS.initiatives,
          line: <code className="branch-picker-branch">{branch}</code>,
        },
      };
    }),
    ...taskChoicesOf(tasks.data, known, project.id).map(({ taskId, title, branch }) => {
      const choice: BranchChoice = { kind: "task", taskId, branch };
      return {
        choice,
        option: {
          value: choiceValueOf(choice),
          label: title,
          alsoMatches: [branch],
          group: BRANCH_PICKER_GROUPS.tasks,
          line: <code className="branch-picker-branch">{branch}</code>,
          title: TASK_BRANCH_NOTE,
        },
      };
    }),
  ];
  // A Task or Initiative chosen stays shown, by its branch, while the lists aren't read.
  const listed = offered.some(({ option }) => option.value === choiceValueOf(chosen));
  const all = listed ? offered : [...offered, { choice: chosen, option: unlistedOption(chosen) }];
  const onPick = (picked: string): void => {
    const found = all.find(({ option }) => option.value === picked);
    if (found) onChange(found.choice);
  };
  return (
    <div
      className="branch-picker"
      onPointerDownCapture={() => setOpened(true)}
      onFocusCapture={() => setOpened(true)}
      onClickCapture={() => setOpened(true)}
    >
      <SearchableSelect
        label={label}
        size="sm"
        value={choiceValueOf(chosen)}
        options={all.map(({ option }) => option)}
        limit={EVERY_MATCH}
        hint={branches.isFetching ? FETCHING_BRANCHES : undefined}
        noMatches={NO_BRANCH_MATCHES}
        onChange={onPick}
      />
      {branches.error && <RefusalAlert title="The branches can't be read" error={branches.error} />}
      {known?.fetchProblem != null && (
        <p className="project-block-note">{fetchProblemWords(known.fetchProblem)}</p>
      )}
    </div>
  );
}

/** A choice not among those listed, named by its branch in its own group. */
function unlistedOption(choice: BranchChoice): SearchableSelectOption {
  const group =
    choice.kind === "branch"
      ? BRANCH_PICKER_GROUPS.branches
      : choice.kind === "task"
        ? BRANCH_PICKER_GROUPS.tasks
        : BRANCH_PICKER_GROUPS.initiatives;
  return { value: choiceValueOf(choice), label: choice.branch, group };
}
