import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  isOffBoardTask,
  PROJECT_LIMIT_MAX,
  type Project,
  type TaskSummary,
} from "@the-office/contracts";
import { Stepper } from "@the-office/ui";
import type { ReactNode } from "react";
import { changeProjectLimit, projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { onlyProject } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { useWaitingOnYou } from "../../shell/work/waiting-on-you.ts";
import { ProjectBlock } from "./project-block.tsx";

interface Tile {
  readonly label: string;
  readonly includes: (task: TaskSummary, waitsOnYou: (task: TaskSummary) => boolean) => boolean;
}

const TILES: readonly Tile[] = [
  { label: "Running", includes: ({ state }) => state === "in-progress" || state === "paused" },
  { label: "Waiting on you", includes: (task, waitsOnYou) => waitsOnYou(task) },
  { label: "Ready to start", includes: ({ state }) => state === "ready" },
  {
    label: "Not planned yet",
    includes: ({ state }) => state === "backlog" || state === "planning",
  },
];

/**
 * How many of the Project's Tasks are where, Off-board Tasks left out, with the board one click
 * away, and how many may run at once.
 */
export function WorkBlock({ project }: { readonly project: Project }): ReactNode {
  const tasks = useQuery(taskQueries.list());
  const projects = useQuery(projectQueries.list());
  const { choose } = useProjectFilter();
  const waitsOnYou = useWaitingOnYou();
  // Off-board Tasks show on the Onboarding and Run environment cards instead.
  const ofProject =
    tasks.data?.filter((task) => task.projectId === project.id && !isOffBoardTask(task)) ?? [];
  return (
    <ProjectBlock
      icon="kanban"
      title="Work"
      actions={
        <>
          <Link to="/work" className="project-block-link">
            Open in Work
          </Link>
          <Link
            to="/work/ci"
            className="project-block-link"
            onClick={() =>
              choose(
                onlyProject(
                  project.id,
                  (projects.data ?? []).map(({ id }) => id),
                ),
              )
            }
          >
            CI runs
          </Link>
        </>
      }
    >
      <div className="work-tiles">
        {TILES.map(({ label, includes }) => (
          <div key={label} className="work-tile">
            <div className="work-tile-label">{label}</div>
            <div className="work-tile-value">
              {ofProject.filter((task) => includes(task, waitsOnYou)).length}
            </div>
          </div>
        ))}
      </div>
      <p className="project-block-note">
        Off-board Tasks aren&apos;t counted here: the Onboarding and Run environment cards show
        them. They still take a running slot under &ldquo;Running Tasks at once in this
        Project&rdquo;.
      </p>
      <ProjectLimitRow project={project} />
    </ProjectBlock>
  );
}

/** The Project limit, saved at once: Start queues a Task of this Project beyond it. */
function ProjectLimitRow({ project }: { readonly project: Project }): ReactNode {
  const queryClient = useQueryClient();
  const saving = useMutation({
    mutationFn: (projectLimit: number) => changeProjectLimit(project.id, projectLimit),
    onSuccess: (saved) => queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved),
  });
  return (
    <>
      <div className="project-limit-row">
        <b className="project-limit-label">Running Tasks at once in this Project</b>
        <Stepper
          label="running Tasks at once in this Project"
          value={project.projectLimit}
          min={1}
          max={PROJECT_LIMIT_MAX}
          disabled={saving.isPending}
          onChange={(projectLimit) => saving.mutate(projectLimit)}
        />
      </div>
      <p className="project-block-note">
        Lowering it lets running Tasks finish; nothing new starts in this Project until one ends.
      </p>
      {saving.error && (
        <p className="project-block-error" role="alert">
          {saving.error.message}
        </p>
      )}
    </>
  );
}
