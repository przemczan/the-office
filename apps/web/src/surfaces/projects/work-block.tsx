import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project, Task } from "@the-office/contracts";
import type { ReactNode } from "react";
import { taskQueries } from "../../api/work.ts";
import { useWaitingOnYou } from "../../shell/work/waiting-on-you.ts";
import { ProjectBlock } from "./project-block.tsx";

interface Tile {
  readonly label: string;
  readonly includes: (task: Task, waitsOnYou: (task: Task) => boolean) => boolean;
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

/** How many of the Project's Tasks are where, with the board one click away. */
export function WorkBlock({ project }: { readonly project: Project }): ReactNode {
  const tasks = useQuery(taskQueries.list());
  const waitsOnYou = useWaitingOnYou();
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
        {TILES.map(({ label, includes }) => (
          <div key={label} className="work-tile">
            <div className="work-tile-label">{label}</div>
            <div className="work-tile-value">
              {ofProject.filter((task) => includes(task, waitsOnYou)).length}
            </div>
          </div>
        ))}
      </div>
    </ProjectBlock>
  );
}
