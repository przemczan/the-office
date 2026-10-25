import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project, Task, TaskState } from "@the-office/contracts";
import type { ReactNode } from "react";
import { taskQueries } from "../../api/work.ts";
import { ProjectBlock } from "./project-block.tsx";

const TILES: readonly { readonly label: string; readonly states: readonly TaskState[] }[] = [
  { label: "Running", states: ["in-progress", "paused"] },
  { label: "Waiting on you", states: ["waiting-on-you"] },
  { label: "Ready to start", states: ["ready"] },
  { label: "Not planned yet", states: ["backlog", "planning"] },
];

/** How many of the Project's Tasks are where, with the board one click away. */
export function WorkBlock({ project }: { readonly project: Project }): ReactNode {
  const tasks = useQuery(taskQueries.list());
  const ofProject = tasks.data?.filter((task) => task.projectId === project.id) ?? [];
  return (
    <ProjectBlock
      icon="kanban"
      title="Work"
      actions={
        <Link to="/work" className="project-block-link">
          Open in Work
        </Link>
      }
    >
      <div className="work-tiles">
        {TILES.map(({ label, states }) => (
          <div key={label} className="work-tile">
            <div className="work-tile-label">{label}</div>
            <div className="work-tile-value">{countIn(ofProject, states)}</div>
          </div>
        ))}
      </div>
    </ProjectBlock>
  );
}

function countIn(tasks: readonly Task[], states: readonly TaskState[]): number {
  return tasks.filter((task) => states.includes(task.state)).length;
}
