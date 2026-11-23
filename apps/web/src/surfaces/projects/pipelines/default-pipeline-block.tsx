import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TASK_KINDS, type Project, type TaskKind } from "@the-office/contracts";
import { Alert } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  changeDefaultPipeline,
  changeKindDefaultPipeline,
  projectQueries,
} from "../../../api/projects.ts";
import {
  choiceById,
  defaultPipelineChoices,
  type PipelineChoiceGroup,
} from "../../../shell/pipelines/pipeline-choices.ts";
import { PipelinePicker } from "../../../shell/pipelines/pipeline-picker.tsx";
import { useProjectPipelineChoices } from "../../../shell/pipelines/use-pipelines.ts";
import { useToast } from "../../../shell/toasts.tsx";
import { KindGlyph } from "../../../shell/work/task-state-badge.tsx";
import { usePlanner } from "../../../shell/work/use-planner.ts";
import { KIND_PLURALS } from "../../../shell/work/work-words.ts";
import { ProjectBlock } from "../project-block.tsx";

/**
 * The Pipeline the Project's Tasks usually follow, one of its own Project Pipelines or an
 * office-wide one, which the Planner starts from and a Task with none lists first. A default that
 * was Broken before The Office updated, not saved since, is flagged. How its work is published is
 * in the Commands block's Publish group. Under it, a row per Kind
 * (docs/design/issues-as-tasks.html): a Kind's own default, or Same as every Task, which stores
 * null.
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
        <Alert
          tone="warning"
          title={`${current.name}, the default, was Broken before The Office updated`}
        >
          New Tasks can&apos;t follow it, and {planner} proposes from the others, until you save it.
        </Alert>
      )}
      <div className="project-setting">
        <div className="project-setting-words">
          <span className="project-setting-name">Every Task</span>
          <span className="project-setting-line">
            What {planner} proposes first, unless the Task&apos;s Kind has its own below.
          </span>
        </div>
        <div className="project-setting-control">
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
      <h4 className="project-group-label">By Kind</h4>
      {TASK_KINDS.map((kind) => (
        <KindDefaultRow
          key={kind}
          project={project}
          kind={kind}
          groups={groups}
          loaded={library !== undefined}
        />
      ))}
    </ProjectBlock>
  );
}

/** The value of Same as every Task, which no Pipeline's id can be, as ids never start with ":". */
export const SAME_AS_EVERY_TASK = ":same-as-every-task";

/** A Kind's own default Pipeline, saved at once; Same as every Task follows the Project's. */
function KindDefaultRow({
  project,
  kind,
  groups,
  loaded,
}: {
  readonly project: Project;
  readonly kind: TaskKind;
  readonly groups: readonly PipelineChoiceGroup[];
  readonly loaded: boolean;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const plural = KIND_PLURALS[kind];
  const choosing = useMutation({
    mutationFn: (pipelineId: string | null) =>
      changeKindDefaultPipeline(project.id, kind, pipelineId),
    onSuccess: (saved, pipelineId) => {
      queryClient.setQueryData(projectQueries.one(saved.id).queryKey, saved);
      showToast(
        pipelineId === null
          ? `${saved.name}'s ${plural} follow its default Pipeline again.`
          : `${saved.name}'s ${plural} follow ${choiceById(groups, pipelineId)?.name ?? pipelineId} now.`,
      );
    },
  });
  const everyTask = choiceById(groups, project.defaultPipeline)?.name ?? project.defaultPipeline;
  const withSame: PipelineChoiceGroup[] = [
    {
      label: "Every Task's",
      choices: [
        {
          id: SAME_AS_EVERY_TASK,
          name: "Same as every Task",
          stages: [],
          line: everyTask,
          isDefault: false,
          brokenWhy: undefined,
        },
      ],
    },
    ...groups,
  ];
  const own = project.kindDefaultPipelines[kind];
  return (
    <div className="project-setting by-kind">
      <div className="project-setting-words">
        <span className="project-setting-name">
          <KindGlyph kind={kind} size={14} />
          {plural}
        </span>
      </div>
      <div className="project-setting-control">
        <PipelinePicker
          label={`Default Pipeline for ${plural}`}
          labelHidden
          size="sm"
          value={own ?? SAME_AS_EVERY_TASK}
          groups={withSame}
          disabled={!loaded || choosing.isPending}
          onChange={(pipelineId) =>
            choosing.mutate(pipelineId === SAME_AS_EVERY_TASK ? null : pipelineId)
          }
        />
        {choosing.error && (
          <p className="project-block-error" role="alert">
            {choosing.error.message}
          </p>
        )}
      </div>
    </div>
  );
}
