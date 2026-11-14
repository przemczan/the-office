import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@the-office/contracts";
import { Alert } from "@the-office/ui";
import type { ReactNode } from "react";
import { changeDefaultPipeline, projectQueries } from "../../../api/projects.ts";
import { choiceById, defaultPipelineChoices } from "../../../shell/pipelines/pipeline-choices.ts";
import { PipelinePicker } from "../../../shell/pipelines/pipeline-picker.tsx";
import { useProjectPipelineChoices } from "../../../shell/pipelines/use-pipelines.ts";
import { useToast } from "../../../shell/toasts.tsx";
import { usePlanner } from "../../../shell/work/use-planner.ts";
import { ProjectBlock } from "../project-block.tsx";

/**
 * The Pipeline the Project's Tasks usually follow, one of its own Project Pipelines or an
 * office-wide one, which the Planner starts from and a Task with none lists first. A Broken
 * default is flagged with why. How its work is published is in the Commands block's Publish group.
 */
export function DefaultPipelineBlock({ project }: { readonly project: Project }): ReactNode {
  const library = useProjectPipelineChoices(project.id);
  const planner = usePlanner()?.card.name ?? "whoever holds Plans";
  const groups = library
    ? defaultPipelineChoices(project, library.officeWide, library.projectPipelines)
    : [];
  const queryClient = useQueryClient();
  const showToast = useToast();
  const keep = (saved: Project): void => {
    queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
  };
  const choosingPipeline = useMutation({
    mutationFn: (pipelineId: string) => changeDefaultPipeline(project.id, pipelineId),
    onSuccess: (saved) => {
      keep(saved);
      const name = choiceById(groups, saved.defaultPipeline)?.name;
      showToast(`${saved.name}'s default Pipeline is ${name ?? saved.defaultPipeline} now.`);
    },
  });
  const current = choiceById(groups, project.defaultPipeline);
  const failure = choosingPipeline.error;
  return (
    <ProjectBlock icon="route" title="Default Pipeline">
      {current?.brokenWhy !== undefined && (
        <Alert tone="danger" title={`${current.name}, the default, is Broken`}>
          {current.brokenReasons.join(" ")} New Tasks can't follow it, and {planner} proposes from
          the others, until it is fixed or another default is chosen.
        </Alert>
      )}
      <div className="pipeline-choice">
        <PipelinePicker
          label="Default Pipeline"
          labelHidden
          size="sm"
          value={project.defaultPipeline}
          groups={groups}
          disabled={library === undefined || choosingPipeline.isPending}
          onChange={(pipelineId) => choosingPipeline.mutate(pipelineId)}
        />
      </div>
      {current && current.brokenWhy === undefined && (
        <p className="project-block-text">
          {current.line}. A new Task has no Pipeline until {planner} proposes one at planning,
          starting from this one, or you choose one.
        </p>
      )}
      {failure && (
        <p className="project-block-error" role="alert">
          {failure.message}
        </p>
      )}
    </ProjectBlock>
  );
}
