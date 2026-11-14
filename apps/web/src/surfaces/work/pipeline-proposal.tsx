import { useQuery } from "@tanstack/react-query";
import type { Pipeline, Task } from "@the-office/contracts";
import { Alert, Badge, Button } from "@the-office/ui";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { setPipeline } from "../../api/work.ts";
import { choiceById, taskPipelineChoices } from "../../shell/pipelines/pipeline-choices.ts";
import { PipelinePicker } from "../../shell/pipelines/pipeline-picker.tsx";
import {
  useEveryPipeline,
  useProjectPipelineChoices,
} from "../../shell/pipelines/use-pipelines.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { useRecordChange } from "./planning-parts.tsx";

/** The proposal's element, for Before Ready's link to it. */
export const PIPELINE_PROPOSAL_ELEMENT_ID = "task-pipeline-proposal";

/**
 * The Pipeline the Planner proposes, with why, at the rail's foot: the user takes it, keeps the one
 * the Task follows (when it has one) or chooses another its Project can follow; each ends the
 * proposal. A Broken one can't be taken.
 */
export function PipelineProposal({
  task,
  pipeline,
}: {
  readonly task: Task;
  /** The Pipeline the Task follows now. */
  readonly pipeline: Pipeline | undefined;
}): ReactNode {
  const planner = usePlanner()?.card.name ?? "Whoever holds Plans";
  const project = useQuery(projectQueries.one(task.projectId)).data;
  const choices = useProjectPipelineChoices(task.projectId);
  const everyPipeline = useEveryPipeline();
  const choosing = useRecordChange(task, (pipelineId: string) => setPipeline(task.id, pipelineId));
  const proposed = task.proposedPipeline;
  if (proposed === null || task.state === "shaping") return null;
  const groups =
    project && choices
      ? taskPipelineChoices(project, choices.officeWide, choices.projectPipelines)
      : [];
  const proposedChoice = choiceById(groups, proposed.pipelineId);
  const proposedName =
    proposedChoice?.name ??
    everyPipeline?.find(({ id }) => id === proposed.pipelineId)?.name ??
    proposed.pipelineId;
  const brokenWhy = proposedChoice?.brokenWhy;
  // A Task with no Pipeline yet has none to keep.
  const currentPipelineId = task.pipelineId;
  const same = proposed.pipelineId === currentPipelineId;
  const others = groups
    .map((group) => ({
      ...group,
      choices: group.choices.filter(
        ({ id }) => id !== proposed.pipelineId && id !== currentPipelineId,
      ),
    }))
    .filter(({ choices: left }) => left.length > 0);
  return (
    <section
      id={PIPELINE_PROPOSAL_ELEMENT_ID}
      className="pipeline-proposal"
      aria-label="Pipeline proposal"
    >
      <p>
        <Badge tone="warning">Proposed by {planner}</Badge>{" "}
        <span className="pipeline-proposal-name">{proposedName}</span>
        {same && " (the one it follows)"}: {proposed.reason}
      </p>
      <div className="pipeline-proposal-actions">
        <Button
          size="sm"
          loading={choosing.isPending && choosing.variables === proposed.pipelineId}
          // Until the choices are read, whether the proposed Pipeline is Broken isn't known.
          disabled={groups.length === 0 || brokenWhy !== undefined}
          title={brokenWhy}
          onClick={() => choosing.mutate(proposed.pipelineId)}
        >
          {same ? "Confirm" : `Use ${proposedName}`}
        </Button>
        {!same && currentPipelineId !== null && (
          <Button
            size="sm"
            variant="secondary"
            loading={choosing.isPending && choosing.variables === currentPipelineId}
            onClick={() => choosing.mutate(currentPipelineId)}
          >
            Keep {pipeline?.name ?? currentPipelineId}
          </Button>
        )}
        {others.length > 0 && (
          <PipelinePicker
            label="Another Pipeline"
            labelHidden
            size="sm"
            placeholder="Another Pipeline…"
            value=""
            groups={others}
            disabled={choosing.isPending}
            onChange={(pipelineId) => choosing.mutate(pipelineId)}
          />
        )}
      </div>
      {brokenWhy !== undefined && (
        <Alert tone="danger" title={`${proposedName} can't be taken`}>
          {brokenWhy}
        </Alert>
      )}
      {choosing.error && <RefusalAlert title="The Pipeline wasn't set" error={choosing.error} />}
    </section>
  );
}
