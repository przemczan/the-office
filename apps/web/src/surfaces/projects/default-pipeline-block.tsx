import { useMutation, useQueryClient } from "@tanstack/react-query";
import { publishingModeSchema, type Project, type PublishingMode } from "@the-office/contracts";
import { Alert, Select } from "@the-office/ui";
import { useId, type ReactNode } from "react";
import { changeDefaultPipeline, changePublishingMode, projectQueries } from "../../api/projects.ts";
import { choiceById, defaultPipelineChoices } from "../../shell/pipelines/pipeline-choices.ts";
import { PipelinePicker } from "../../shell/pipelines/pipeline-picker.tsx";
import { useProjectPipelineChoices } from "../../shell/pipelines/use-pipelines.ts";
import { publishingLabel } from "../../shell/project-words.ts";
import { useToast } from "../../shell/toasts.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { ProjectBlock } from "./project-block.tsx";

/**
 * The Pipeline the Project's Tasks usually follow, one of its own Project Pipelines or an
 * office-wide one, which the Planner starts from and a Task with none lists first, and how its
 * work is published. A Broken default is flagged with why.
 */
export function DefaultPipelineBlock({ project }: { readonly project: Project }): ReactNode {
  const library = useProjectPipelineChoices(project.id);
  const planner = usePlanner()?.card.name ?? "the Planner";
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
  const choosingPublishing = useMutation({
    mutationFn: (mode: PublishingMode) => changePublishingMode(project.id, mode),
    onSuccess: (saved) => {
      keep(saved);
      showToast(
        `Publishing saved. Tasks in ${saved.name} ${publishingLabel(saved.publishingMode, saved.baseBranch).toLowerCase()}.`,
      );
    },
  });
  const publishingSelect = useId();
  const current = choiceById(groups, project.defaultPipeline);
  const failure = choosingPipeline.error ?? choosingPublishing.error;
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
      <div className="project-row">
        <label htmlFor={publishingSelect} className="project-row-label">
          Publishing
        </label>
        <Select
          id={publishingSelect}
          size="sm"
          value={project.publishingMode}
          options={publishingModeSchema.options.map((mode) => ({
            value: mode,
            label: publishingLabel(mode, project.baseBranch),
          }))}
          disabled={choosingPublishing.isPending}
          onChange={(mode) => choosingPublishing.mutate(publishingModeSchema.parse(mode))}
        />
      </div>
      {failure && (
        <p className="project-block-error" role="alert">
          {failure.message}
        </p>
      )}
    </ProjectBlock>
  );
}
