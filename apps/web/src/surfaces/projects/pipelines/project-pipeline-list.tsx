import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project, ProjectPipeline } from "@the-office/contracts";
import { Badge, Button, Icon, PickList, PickListItem } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectPipelineQueries } from "../../../api/pipelines.ts";
import { AskDevopsButton } from "../../../shell/ask-devops.tsx";
import { projectPipelineLine } from "../../../shell/pipelines/stage-change-words.ts";

/**
 * The Project's own Pipelines, each a link to its address with what it is built from; Default and
 * Broken at a row's end, Needs fixing from its check. Its foot adds one, or asks Devops for one.
 */
export function ProjectPipelineList({
  project,
  projectPipelines,
  open,
  onAdd,
}: {
  readonly project: Project;
  readonly projectPipelines: readonly ProjectPipeline[];
  readonly open: ProjectPipeline | undefined;
  readonly onAdd: () => void;
}): ReactNode {
  return (
    <PickList
      name={`${project.name}'s Pipelines`}
      count={projectPipelines.length}
      empty={`None yet: ${project.name}'s Tasks choose from the office-wide Pipelines. Add one to change a few Stages for ${project.name} alone.`}
      foot={
        <div className="project-pipelines-foot">
          <Button
            size="sm"
            variant="secondary"
            title={`A Pipeline of ${project.name}'s own, built from an office-wide one`}
            iconLeft={<Icon name="plus" size={14} />}
            onClick={onAdd}
          >
            Add a Pipeline built from…
          </Button>
          <AskDevopsButton
            label={(name) => `Ask ${name}`}
            draft={`Can you propose a Project Pipeline for ${project.name}? `}
          />
        </div>
      }
    >
      {projectPipelines.map((projectPipeline) => (
        <ProjectPipelineItem
          key={projectPipeline.id}
          project={project}
          projectPipeline={projectPipeline}
          picked={projectPipeline.id === open?.id}
        />
      ))}
    </PickList>
  );
}

function ProjectPipelineItem({
  project,
  projectPipeline,
  picked,
}: {
  readonly project: Project;
  readonly projectPipeline: ProjectPipeline;
  readonly picked: boolean;
}): ReactNode {
  const { id, name, description, basePipeline, stageChanges, broken } = projectPipeline;
  const check = useQuery(
    projectPipelineQueries.check({
      name,
      description,
      basePipelineId: basePipeline.id,
      stageChanges,
      projectId: project.id,
      projectPipelineId: id,
    }),
  );
  const isBroken = broken.length > 0;
  const needsFixing = !isBroken && (check.data?.problems.length ?? 0) > 0;
  const isDefault = project.defaultPipeline === id;
  return (
    <PickListItem
      picked={picked}
      name={name}
      line={projectPipelineLine(projectPipeline)}
      lineTone={isBroken ? "danger" : undefined}
      aside={
        (isDefault || isBroken) && (
          <>
            {isDefault && <Badge size="sm">Default</Badge>}
            {isBroken && (
              <Badge size="sm" tone="danger">
                Broken
              </Badge>
            )}
          </>
        )
      }
      warning={needsFixing ? "Needs fixing" : undefined}
      renderLink={(parts) => (
        <Link
          to="/projects/$projectId/pipelines/$projectPipelineId"
          params={{ projectId: project.id, projectPipelineId: id }}
          {...parts}
        />
      )}
    />
  );
}
