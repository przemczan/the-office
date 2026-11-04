import { useQuery } from "@tanstack/react-query";
import type { Pipeline, Readiness, Task } from "@the-office/contracts";
import { Badge, Button, Icon, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { confirmDefinitionOfDone, confirmPlan, setPipeline, taskQueries } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { useRecordChange } from "./planning-parts.tsx";
import { RecordBlock } from "./record-block.tsx";

/**
 * What Mark Ready waits for, line by line, on a Task in Planning, each with what settles it. The
 * lines come from the same Work rules that refuse Mark Ready, and Mark Ready stays the user's step.
 */
export function BeforeReady({
  task,
  pipeline,
}: {
  readonly task: Task;
  /** The Pipeline the Task follows now. */
  readonly pipeline: Pipeline | undefined;
}): ReactNode {
  const readiness = useQuery(taskQueries.readiness(task.id));
  return (
    <RecordBlock icon="list-checks" title="Before Ready">
      <ul className="task-checklist">
        {readiness.data?.lines.map(({ part, label, met, problems }) => (
          <li key={part} className={met ? "task-checklist-met" : undefined}>
            <Icon name={met ? "check" : "circle"} size={14} />
            <div className="before-ready-line">
              <span>
                {label}
                {!met && <span className="task-quiet"> · {problems.join(" ")}</span>}
              </span>
              <SettlingPart part={part} task={task} pipeline={pipeline} />
            </div>
          </li>
        ))}
      </ul>
    </RecordBlock>
  );
}

/** Read from the Task, not the line, which lags it by a refetch once a part is settled. */
function SettlingPart({
  part,
  task,
  pipeline,
}: {
  readonly part: Readiness["lines"][number]["part"];
  readonly task: Task;
  readonly pipeline: Pipeline | undefined;
}): ReactNode {
  switch (part) {
    case "plan":
      if (task.plan === "" || task.planConfirmed) return null;
      return (
        <ConfirmPart
          task={task}
          name="Plan"
          confirm={() =>
            confirmPlan(task.id, { plan: task.plan, filesToChange: [...task.filesToChange] })
          }
        />
      );
    case "definition-of-done":
      if (task.definitionOfDone.length === 0 || task.definitionOfDoneConfirmed) return null;
      return (
        <ConfirmPart
          task={task}
          name="Definition of Done"
          confirm={() => confirmDefinitionOfDone(task.id, task.definitionOfDone)}
        />
      );
    case "pipeline":
      return <ProposedPipeline task={task} pipeline={pipeline} />;
    case "decisions":
      return null;
  }
}

/** Confirms a part as it reads in the record; Edit, on its fold, confirms the user's own words. */
function ConfirmPart({
  task,
  name,
  confirm,
}: {
  readonly task: Task;
  readonly name: string;
  readonly confirm: () => Promise<Task>;
}): ReactNode {
  const confirming = useRecordChange<void>(task, confirm);
  return (
    <>
      <Button size="sm" loading={confirming.isPending} onClick={() => confirming.mutate()}>
        Confirm
      </Button>
      {confirming.error && (
        <div className="before-ready-refusal">
          <RefusalAlert title={`The ${name} wasn't saved`} error={confirming.error} />
        </div>
      )}
    </>
  );
}

/**
 * The Pipeline the Planner proposes, with why, until the user takes it, keeps the one the Task
 * follows or chooses another from the library; each ends the proposal.
 */
function ProposedPipeline({
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
    <div className="task-proposed-pipeline">
      <p>
        <Badge tone="warning">Proposed by {planner}</Badge> {proposedName}
        {same && " (the one it follows)"}: {proposed.reason}
      </p>
      <div className="task-part-actions">
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
    </div>
  );
}
