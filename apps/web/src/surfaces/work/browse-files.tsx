import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  initiativeBranchOf,
  type Initiative,
  type ProjectBranches,
  type Task,
} from "@the-office/contracts";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries } from "../../api/work.ts";
import { isPublishingTask } from "./initiative-words.ts";
import type { RecordAction } from "./record-actions.tsx";

/**
 * "Browse files" in a Task's head, once its branch is known here: `office/<task id>`, or for a
 * Publishing Task its Initiative's branch, which is what it publishes.
 */
export function useBrowseFilesAction(task: Task): RecordAction | undefined {
  const publishing = isPublishingTask(task);
  const initiative = useQuery({
    ...initiativeQueries.one(task.initiativeId ?? ""),
    enabled: publishing && task.initiativeId !== null,
  });
  const branches = useQuery(projectQueries.branches(task.projectId, { fetch: false }));
  const navigate = useNavigate();
  const shortName = initiative.data?.shortName ?? null;
  const branch = publishing
    ? shortName === null
      ? undefined
      : initiativeBranchOf(shortName)
    : `office/${task.id}`;
  if (branch === undefined || !hasBranch(branches.data, branch)) return undefined;
  return browseFilesAction(task.projectId, branch, "Browse files", navigate);
}

/**
 * "Browse files" in an Initiative's head for each Project it spans where its branch is known here,
 * naming the Project when it spans several.
 */
export function useBrowseInitiativeFilesActions(initiative: Initiative): RecordAction[] {
  const projects = useQuery(projectQueries.list());
  const branchesOf = useQueries({
    queries: initiative.projectIds.map((projectId) =>
      projectQueries.branches(projectId, { fetch: false }),
    ),
  });
  const navigate = useNavigate();
  const shortName = initiative.shortName;
  if (shortName === null) return [];
  const branch = initiativeBranchOf(shortName);
  const several = initiative.projectIds.length > 1;
  return initiative.projectIds.flatMap((projectId, index) => {
    if (!hasBranch(branchesOf[index]?.data, branch)) return [];
    const name = projects.data?.find(({ id }) => id === projectId)?.name ?? projectId;
    const label = several ? `Browse files in ${name}` : "Browse files";
    return [browseFilesAction(projectId, branch, label, navigate)];
  });
}

function browseFilesAction(
  projectId: string,
  branch: string,
  label: string,
  navigate: ReturnType<typeof useNavigate>,
): RecordAction {
  const files = filesOf(projectId, branch);
  return {
    key: `browse-files-${projectId}`,
    label,
    icon: "folder-tree",
    zone: "go-to",
    onSelect: () => void navigate(files),
    link: (anchor) => <Link {...anchor} {...files} />,
  };
}

function filesOf(projectId: string, branch: string) {
  return {
    to: "/projects/$projectId/files",
    params: { projectId },
    search: { branch },
  } as const;
}

function hasBranch(branches: ProjectBranches | undefined, name: string): boolean {
  if (branches === undefined) return false;
  return (
    branches.baseBranch.name === name || branches.branches.some((branch) => branch.name === name)
  );
}
