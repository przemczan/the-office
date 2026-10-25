import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { publishingModeSchema, type Project, type PublishingMode } from "@the-office/contracts";
import { Select } from "@the-office/ui";
import { useId, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { changeDefaultPipeline, changePublishingMode, projectQueries } from "../../api/projects.ts";
import { useToast } from "../../shell/toasts.tsx";
import { ProjectBlock } from "./project-block.tsx";
import { publishingLabel, stagesLine } from "./project-labels.ts";

/** The Pipeline a new Task starts from, and how its work is published. */
export function DefaultPipelineBlock({ project }: { readonly project: Project }): ReactNode {
  const pipelines = useQuery(pipelineQueries.list());
  const queryClient = useQueryClient();
  const showToast = useToast();
  const keep = (saved: Project): void => {
    queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
  };
  const choosingPipeline = useMutation({
    mutationFn: (pipelineId: string) => changeDefaultPipeline(project.id, pipelineId),
    onSuccess: (saved) => {
      keep(saved);
      const name = pipelines.data?.find((pipeline) => pipeline.id === saved.defaultPipeline)?.name;
      showToast(`New Tasks in ${saved.name} start from ${name ?? saved.defaultPipeline}.`);
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
  const pipelineSelect = useId();
  const publishingSelect = useId();
  const current = pipelines.data?.find((pipeline) => pipeline.id === project.defaultPipeline);
  const failure = choosingPipeline.error ?? choosingPublishing.error ?? pipelines.error;
  return (
    <ProjectBlock icon="route" title="Default Pipeline">
      <div className="pipeline-choice">
        <label htmlFor={pipelineSelect} className="visually-hidden">
          Default Pipeline
        </label>
        <Select
          id={pipelineSelect}
          size="sm"
          value={project.defaultPipeline}
          options={(pipelines.data ?? []).map((pipeline) => ({
            value: pipeline.id,
            label: pipeline.name,
          }))}
          disabled={pipelines.data === undefined || choosingPipeline.isPending}
          onChange={(pipelineId) => choosingPipeline.mutate(pipelineId)}
        />
      </div>
      {current && (
        <p className="project-block-text">
          {stagesLine(current)}. The Planner proposes a Pipeline per Task at planning; this is the
          starting point.
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
