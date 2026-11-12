import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { OfficeWidePipeline } from "@the-office/contracts";
import { Badge, Card, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../../api/projects.ts";
import { builtOnByWords, counted } from "../../../shell/pipelines/stage-change-words.ts";
import { ProjectMark } from "../../../shell/project-mark.tsx";

/**
 * Built on by: the Projects whose Project Pipelines are built from the office-wide Pipeline, each
 * with how many and how many are Broken, and a link to its Pipelines; the Project Pipelines
 * themselves are listed on their Project's page alone (spec §2.3, "The library editor").
 */
export function BuiltOnByCard({ pipeline }: { readonly pipeline: OfficeWidePipeline }): ReactNode {
  const projects = useQuery(projectQueries.list()).data ?? [];
  const total = builtOnByTotal(pipeline);
  if (total === 0) return null;
  const title = builtOnByWords(total);
  return (
    <Card
      title={
        <span className="settings-block-title">
          <Icon name="route" size={15} strokeWidth={1.6} />
          {title}
        </span>
      }
    >
      <p className="settings-note">
        Each Project edits its own on its page, with its Stage changes on top of {pipeline.name}'s
        Stages.
      </p>
      <ul className="built-on-rows" aria-label={title}>
        {pipeline.builtOnBy.map(({ projectId, projectPipelines, broken }) => {
          const project = projects.find(({ id }) => id === projectId);
          const name = project?.name ?? projectId;
          return (
            <li key={projectId}>
              <Link
                className="built-on-row"
                to="/projects/$projectId/pipelines"
                params={{ projectId }}
                title={`Open ${name}'s Pipelines`}
              >
                <span className="built-on-row-name">
                  {project && <ProjectMark project={project} />}
                  {name}
                </span>
                <span className="built-on-row-aside">
                  {broken > 0 && (
                    <Badge size="sm" tone="danger">
                      {broken} Broken
                    </Badge>
                  )}
                </span>
                <Icon name="arrow-right" size={14} />
                <span className="built-on-row-line">
                  {counted(projectPipelines, "Project Pipeline", "Project Pipelines")}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** How many Project Pipelines are built from it, and how many of them are Broken. */
export function builtOnByTotal({ builtOnBy }: OfficeWidePipeline): number {
  return builtOnBy.reduce((sum, { projectPipelines }) => sum + projectPipelines, 0);
}

export function brokenBuiltOnByTotal({ builtOnBy }: OfficeWidePipeline): number {
  return builtOnBy.reduce((sum, { broken }) => sum + broken, 0);
}
