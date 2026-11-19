import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CiRun, CiRunJobs, CiRunListing, Project } from "@the-office/contracts";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Icon,
  IconButton,
  type DataTableColumn,
} from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ciRunQueries, refreshCiRuns, rerunCiRun } from "../../api/ci-runs.ts";
import { projectQueries } from "../../api/projects.ts";
import { BlockLoader } from "../../shell/block-loader.tsx";
import { FloatingMenu } from "../../shell/floating-menu.tsx";
import { GitHubPermissionsPrompt } from "../../shell/github-permissions-prompt.tsx";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { narrowed } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import {
  canRerun,
  CI_RUN_STATUS_WORDS,
  ciRunName,
  IN_OTHER_PROJECTS,
  NO_CI_RUNS,
  OUT_OF_DATE,
  OUT_OF_DATE_TITLE,
  problemTitle,
  problemWords,
  REFRESH_HINT,
  RERUN_ALL,
  RERUN_FAILED,
  shortCommit,
  START_A_WORKFLOW,
  startedWords,
} from "./ci-run-words.ts";
import { StartWorkflowDialog } from "./start-workflow-dialog.tsx";

/**
 * Work › CI: each Project's recent CI runs, in the Projects the Project filter shows, as the
 * service last read them from the code host; Refresh asks for a read now, and `ci-runs.changed`
 * brings what it found. A failed or cancelled run can run again, and Start a workflow starts one by
 * hand.
 */
export function CiRunsPage(): ReactNode {
  const list = useQuery(ciRunQueries.list());
  const projects = useQuery(projectQueries.list());
  const projectFilter = useProjectFilter();
  const refreshing = useMutation({ mutationFn: refreshCiRuns });
  const [starting, setStarting] = useState(false);
  const { shown, elsewhere } = narrowed(list.data?.runs ?? [], (run) =>
    projectFilter.shows([run.projectId]),
  );
  const listings = (list.data?.projects ?? []).filter((listing) =>
    projectFilter.shows([listing.projectId]),
  );
  const startable = (projects.data ?? []).filter((project) =>
    listings.some((listing) => listing.projectId === project.id),
  );
  const { filter } = projectFilter;
  const staleProjects = new Set(
    listings.filter((listing) => listing.stale).map((listing) => listing.projectId),
  );
  return (
    <div className="pull-requests-page">
      <GitHubPermissionsPrompt />
      <div className="pull-requests-head">
        <span className="pull-requests-hint">{REFRESH_HINT}</span>
        <span className="ci-runs-head-actions">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="refresh-cw" size={14} />}
            loading={refreshing.isPending}
            onClick={() => refreshing.mutate()}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            iconLeft={<Icon name="play" size={14} />}
            onClick={() => setStarting(true)}
          >
            {START_A_WORKFLOW}
          </Button>
        </span>
      </div>
      {starting && (
        <StartWorkflowDialog
          projects={startable}
          presetProjectId={filter !== "all" && filter.length === 1 ? filter[0] : undefined}
          onClose={() => setStarting(false)}
        />
      )}
      {refreshing.error && (
        <RefusalAlert title="The CI runs weren't refreshed" error={refreshing.error} />
      )}
      {listings.map((listing) => (
        <ProblemAlert key={listing.projectId} listing={listing} projects={projects.data} />
      ))}
      {list.error && <Alert tone="danger" title={list.error.message} />}
      {!list.data && !list.error && <BlockLoader shape="rows" label="Loading CI runs…" />}
      {list.data && (
        <>
          <InOtherProjectsNote count={elsewhere} {...IN_OTHER_PROJECTS} />
          <DataTable
            columns={columnsFor(projects.data, staleProjects)}
            rows={[...shown]}
            empty={NO_CI_RUNS}
          />
        </>
      )}
    </div>
  );
}

function ProblemAlert({
  listing,
  projects,
}: {
  readonly listing: CiRunListing;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  if (listing.problem === null) return null;
  const name = projects?.find((project) => project.id === listing.projectId)?.name;
  return (
    <Alert tone="warning" title={problemTitle(name ?? listing.projectId)}>
      {problemWords(listing.problem)}
    </Alert>
  );
}

function columnsFor(
  projects: readonly Project[] | undefined,
  staleProjects: ReadonlySet<string>,
): DataTableColumn<CiRun>[] {
  return [
    {
      key: "status",
      header: "Status",
      render: (run) => {
        const words = CI_RUN_STATUS_WORDS[run.status];
        return (
          <span className="ci-runs-stale">
            <span title={words.title}>
              <Badge tone={words.tone} dot size="sm">
                {words.label}
              </Badge>
            </span>
            {staleProjects.has(run.projectId) && (
              <span title={OUT_OF_DATE_TITLE}>
                <Badge tone="warning" size="sm">
                  {OUT_OF_DATE}
                </Badge>
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "run",
      header: "Run",
      wrap: true,
      render: (run) => (
        <span className="ci-run-name">
          <a className="ci-run-link" href={run.url} target="_blank" rel="noopener noreferrer">
            {ciRunName(run)}
            <Icon name="external-link" size={12} />
          </a>
          {run.attempt > 1 && <span className="ci-run-attempt">attempt {run.attempt}</span>}
        </span>
      ),
    },
    {
      key: "project",
      header: "Project",
      render: (run) => <ProjectChip projectId={run.projectId} projects={projects} />,
    },
    {
      key: "branch",
      header: "Branch",
      mono: true,
      wrap: true,
      render: (run) => (
        <span className="ci-run-branch">
          <span>{run.branch ?? "—"}</span>
          {run.taskId !== null && (
            <Link to="/tasks/$taskId" params={{ taskId: run.taskId }}>
              Task
            </Link>
          )}
        </span>
      ),
    },
    {
      key: "commit",
      header: "Commit",
      mono: true,
      render: (run) => shortCommit(run.commit),
    },
    { key: "trigger", header: "Trigger", render: (run) => run.trigger },
    {
      key: "started",
      header: "Started",
      muted: true,
      render: (run) => startedWords(run.startedAt),
    },
    {
      key: "actions",
      header: "",
      render: (run) => (canRerun(run) ? <RerunCell run={run} /> : null),
    },
  ];
}

/** The re-run menu of one failed or cancelled run, with its own pending state and refusal. */
function RerunCell({ run }: { readonly run: CiRun }): ReactNode {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const rerunning = useMutation({
    mutationFn: (jobs: CiRunJobs) => rerunCiRun(run.projectId, run.id, jobs),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ci-runs"] }),
  });
  return (
    <div className="ci-run-actions">
      <FloatingMenu
        open={open}
        onOpenChange={setOpen}
        align="end"
        width={200}
        trigger={
          <IconButton
            size="xs"
            icon={<Icon name={rerunning.isPending ? "loader" : "ellipsis"} size={14} />}
            label={`More for ${ciRunName(run)}`}
            disabled={rerunning.isPending}
          />
        }
        items={[
          {
            icon: <Icon name="rotate-ccw" size={14} />,
            label: RERUN_ALL,
            onSelect: () => rerunning.mutate("all"),
          },
          {
            icon: <Icon name="rotate-ccw" size={14} />,
            label: RERUN_FAILED,
            onSelect: () => rerunning.mutate("failed"),
          },
        ]}
      />
      {rerunning.isPending && <span className="ci-run-attempt">Re-running…</span>}
      {rerunning.error && (
        <span className="ci-run-refusal" role="alert">
          {rerunning.error.message}
        </span>
      )}
    </div>
  );
}
