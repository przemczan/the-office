import { useQuery } from "@tanstack/react-query";
import type { Project } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { ProjectMark } from "../project-mark.tsx";
import { useClosedFromOutside } from "../use-closed-from-outside.ts";
import {
  onlyProject,
  projectFilterLabel,
  showsProject,
  withProjectToggled,
} from "./project-filter-choices.ts";
import { useProjectFilter } from "./use-project-filter.ts";

/** The marks shown on the trigger at most; the label says how many more. */
const MARKS_SHOWN = 3;

/**
 * The top bar's Project filter (prototypes/app/core.js `projectPicker`): All projects, or any
 * Projects turned on and off, or one alone. The design system's Menu closes on every choice, so
 * this one stays open while Projects are turned on and off.
 */
export function ProjectFilterMenu(): ReactNode {
  const projects = useQuery(projectQueries.list());
  const { filter, choose } = useProjectFilter();
  const [open, setOpen] = useState(false);
  const menu = useClosedFromOutside(open, setOpen);
  const projectIds = projects.data?.map(({ id }) => id) ?? [];
  const label = projectFilterLabel(filter, projects.data);
  const shown = projects.data?.filter(({ id }) => showsProject(filter, id)) ?? [];
  return (
    <div className="project-filter" ref={menu}>
      <button
        type="button"
        className={`project-filter-trigger${filter === "all" ? "" : " narrowed"}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {filter === "all" ? (
          <Icon name="layers" size={14} />
        ) : (
          <span className="project-filter-stack">
            {shown.slice(0, MARKS_SHOWN).map((project) => (
              <ProjectMark key={project.id} project={project} />
            ))}
          </span>
        )}
        <span className="visually-hidden">Project filter: </span>
        <span className="project-filter-label">{label}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="project-filter-menu" role="group" aria-label="Projects shown">
          <div className={`project-filter-row${filter === "all" ? " on" : ""}`}>
            <button
              type="button"
              className="project-filter-option"
              aria-pressed={filter === "all"}
              onClick={() => {
                choose("all");
                setOpen(false);
              }}
            >
              <Check on={filter === "all"} />
              <Icon name="layers" size={14} />
              All projects
            </button>
          </div>
          {projects.data?.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              on={showsProject(filter, project.id)}
              onToggle={() => choose(withProjectToggled(filter, project.id, projectIds))}
              onOnly={() => {
                choose(onlyProject(project.id, projectIds));
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  on,
  onToggle,
  onOnly,
}: {
  readonly project: Project;
  readonly on: boolean;
  readonly onToggle: () => void;
  readonly onOnly: () => void;
}): ReactNode {
  return (
    <div className={`project-filter-row${on ? " on" : ""}`}>
      <button type="button" className="project-filter-option" aria-pressed={on} onClick={onToggle}>
        <Check on={on} />
        <ProjectMark project={project} />
        {project.name}
      </button>
      <button
        type="button"
        className="project-filter-only"
        aria-label={`Show only ${project.name}`}
        title={`Show only ${project.name}`}
        onClick={onOnly}
      >
        <Icon name="crosshair" size={14} />
      </button>
    </div>
  );
}

function Check({ on }: { readonly on: boolean }): ReactNode {
  return <span className="project-filter-check">{on && <Icon name="check" size={14} />}</span>;
}
