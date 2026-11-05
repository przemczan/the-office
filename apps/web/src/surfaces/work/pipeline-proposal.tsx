import { useQuery } from "@tanstack/react-query";
import type { Pipeline, Task } from "@the-office/contracts";
import { Badge, Button, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { setPipeline } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { useRecordChange } from "./planning-parts.tsx";

/** The proposal's element, for Before Ready's link to it. */
export const PIPELINE_PROPOSAL_ELEMENT_ID = "task-pipeline-proposal";

/**
 * The Pipeline the Planner proposes, with why, at the rail's foot: the user takes it, keeps the one
 * the Task follows or chooses another from the library; each ends the proposal.
 */
export function PipelineProposal({
  task,
  pipeline,
}: {
  readonly task: Task;
  /** The Pipeline the Task follows now. */
  readonly pipeline: Pipeline | undefined;
}): ReactNode {
  const planner = usePlanner()?.card.name ?? "The Planner";
  const pipelines = useQuery(pipelineQueries.list());
  const choosing = useRecordChange(task, (pipelineId: string) => setPipeline(task.id, pipelineId));
  const proposed = task.proposedPipeline;
  if (proposed === null) return null;
  const nameOf = (id: string): string =>
    pipelines.data?.find((candidate) => candidate.id === id)?.name ?? id;
  const proposedName = nameOf(proposed.pipelineId);
  const current = pipeline?.name ?? task.pipelineId;
  const same = proposed.pipelineId === task.pipelineId;
  const others =
    pipelines.data?.filter(({ id }) => id !== proposed.pipelineId && id !== task.pipelineId) ?? [];
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
          onClick={() => choosing.mutate(proposed.pipelineId)}
        >
          {same ? "Confirm" : `Use ${proposedName}`}
        </Button>
        {!same && (
          <Button
            size="sm"
            variant="secondary"
            loading={choosing.isPending && choosing.variables === task.pipelineId}
            onClick={() => choosing.mutate(task.pipelineId)}
          >
            Keep {current}
          </Button>
        )}
        {others.length > 0 && (
          <Select
            aria-label="Another Pipeline"
            size="sm"
            placeholder="Another Pipeline…"
            value=""
            disabled={choosing.isPending}
            options={others.map(({ id, name }) => ({ value: id, label: name }))}
            onChange={(pipelineId) => choosing.mutate(pipelineId)}
          />
        )}
      </div>
      {choosing.error && <RefusalAlert title="The Pipeline wasn't set" error={choosing.error} />}
    </section>
  );
}
