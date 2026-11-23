import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Project, ProjectPipeline } from "@the-office/contracts";
import { Badge, Button, Icon, PickList, PickListItem } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectPipelineQueries } from "../../../api/pipelines.ts";
import { AskDevopsButton } from "../../../shell/ask-devops.tsx";
import { counted } from "../../../shell/pipelines/pipeline-words.ts";

/**
 * The Project's own Pipelines, each a link to its address with what it was copied from and its
 * Stages; Default at a row's end, and Needs fixing while its check finds a problem or a warning, or
 * while it was Broken before The Office updated and isn't saved since. Its foot copies one in, or
 * asks Devops for one.
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
  const needingFixing = useQuery(projectPipelineQueries.needingFixing(project.id)).data;
  return (
    <PickList
      name={`${project.name}'s Pipelines`}
      count={projectPipelines.length}
      empty={`None yet: ${project.name}'s Tasks choose from the office-wide Pipelines. Copy one to change it for ${project.name} alone.`}
      foot={
        <div className="project-pipelines-foot">
          <Button
            size="sm"
            variant="secondary"
            title={`A Pipeline of ${project.name}'s own, copied from another`}
            iconLeft={<Icon name="plus" size={14} />}
            onClick={onAdd}
          >
            New Pipeline
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
          needsFixing={needingFixing?.has(projectPipeline.id) ?? false}
        />
      ))}
    </PickList>
  );
}

function ProjectPipelineItem({
  project,
  projectPipeline,
  picked,
  needsFixing,
}: {
  readonly project: Project;
  readonly projectPipeline: ProjectPipeline;
  readonly picked: boolean;
  readonly needsFixing: boolean;
}): ReactNode {
  const { id, name, stages, copiedFrom } = projectPipeline;
  const isDefault = project.defaultPipeline === id;
  return (
    <PickListItem
      picked={picked}
      name={name}
      line={`Copied from ${copiedFrom.name} · ${counted(stages.length, "Stage", "Stages")}`}
      aside={isDefault && <Badge size="sm">Default</Badge>}
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
