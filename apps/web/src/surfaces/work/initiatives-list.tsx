import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Initiative, Project, Role, Task } from "@the-office/contracts";
import { Alert, ProgressBar } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, taskQueries } from "../../api/work.ts";
import { EmptyCard } from "../../shell/item-card.tsx";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { useCto } from "../../shell/work/use-cto.ts";
import { InitiativeProjects, InitiativeStateBadge } from "./initiative-parts.tsx";
import { initiativeProgress, progressWords, tasksOfInitiative } from "./initiative-words.ts";

/**
 * Work › Initiatives (prototypes/app/work.js `initiativesList`): a card for each the Project filter
 * shows, the newest first.
 */
export function InitiativesList(): ReactNode {
  const initiatives = useQuery(initiativeQueries.list());
  const tasks = useQuery(taskQueries.list());
  const projects = useQuery(projectQueries.list());
  const cto = useCto();
  const projectFilter = useProjectFilter();
  if (initiatives.error) return <Alert tone="danger" title={initiatives.error.message} />;
  if (!initiatives.data || !tasks.data) return null;
  if (initiatives.data.length === 0) {
    return <EmptyCard>No Initiatives yet. Shape an Idea into one from Ideas.</EmptyCard>;
  }
  const shown = initiatives.data.filter(({ projectIds }) => projectFilter.shows(projectIds));
  return (
    <>
      <InOtherProjectsNote
        count={initiatives.data.length - shown.length}
        one="Initiative"
        many="Initiatives"
      />
      {shown.length > 0 && (
        <div className="initiative-cards">
          {shown.map((initiative) => (
            <InitiativeCard
              key={initiative.id}
              initiative={initiative}
              tasks={tasks.data}
              projects={projects.data}
              cto={cto}
            />
          ))}
        </div>
      )}
    </>
  );
}

function InitiativeCard({
  initiative,
  tasks,
  projects,
  cto,
}: {
  readonly initiative: Initiative;
  readonly tasks: readonly Task[];
  readonly projects: readonly Project[] | undefined;
  readonly cto: Role | undefined;
}): ReactNode {
  const progress = initiativeProgress(tasksOfInitiative(initiative, tasks), tasks);
  return (
    <Link
      to="/work/initiatives/$initiativeId"
      params={{ initiativeId: initiative.id }}
      className="initiative-card"
      aria-label={initiative.name}
    >
      <span className="initiative-card-head">
        <span className="initiative-card-name">{initiative.name}</span>
        <InitiativeStateBadge initiative={initiative} cto={cto} />
      </span>
      <span className="initiative-card-sub">
        <InitiativeProjects initiative={initiative} projects={projects} />
      </span>
      <span className="initiative-card-outcome">
        {initiative.outcome === "" ? "Outcome not written yet." : initiative.outcome}
      </span>
      <ProgressBar
        value={progress.done}
        max={Math.max(progress.counted, 1)}
        tone="success"
        size="sm"
        valueLabel=""
      />
      <span className="initiative-card-sub">{progressWords(progress)}</span>
    </Link>
  );
}
