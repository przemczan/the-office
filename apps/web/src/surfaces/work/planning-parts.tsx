import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Pipeline, Task } from "@the-office/contracts";
import { Badge, Button, Icon, Select, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { confirmDefinitionOfDone, confirmPlan, setPipeline, taskQueries } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { statementsOf } from "./planning-words.ts";
import { RecordBlock } from "./record-block.tsx";

/**
 * The Plan and the Definition of Done the Planner writes are proposed until the user confirms
 * them as shown or saves an edit; both stay editable until the Task starts.
 */
interface PartProps {
  readonly task: Task;
  /** The Planner's name, who proposes it. */
  readonly planner: string;
}

export function DefinitionOfDoneBlock({ task, planner }: PartProps): ReactNode {
  const confirming = useRecordChange(task, (statements: readonly string[]) =>
    confirmDefinitionOfDone(task.id, statements),
  );
  const [editing, setEditing] = useState(false);
  const written = task.definitionOfDone.length > 0;
  return (
    <RecordBlock
      icon="list-checks"
      title="Definition of Done"
      actions={
        !editing && (
          <PartActions
            task={task}
            planner={planner}
            written={written}
            confirmed={task.definitionOfDoneConfirmed}
            confirming={confirming.isPending}
            onConfirm={() => confirming.mutate(task.definitionOfDone)}
            onEdit={() => setEditing(true)}
          />
        )
      }
    >
      {confirming.error && (
        <RefusalAlert title="The Definition of Done wasn't saved" error={confirming.error} />
      )}
      {editing ? (
        <PartEditor
          label="Definition of Done"
          hint="One statement per line: what must be true when the Task is done."
          initial={task.definitionOfDone.join("\n")}
          saving={confirming.isPending}
          onSave={(text) =>
            confirming.mutate(statementsOf(text), { onSuccess: () => setEditing(false) })
          }
          onCancel={() => setEditing(false)}
        />
      ) : written ? (
        <ul className="task-dod">
          {task.definitionOfDone.map((statement) => (
            <li key={statement}>{statement}</li>
          ))}
        </ul>
      ) : (
        <p className="task-quiet">
          Not written yet. {planner} proposes it during planning; a Task can't be Ready without one.
        </p>
      )}
    </RecordBlock>
  );
}

export function PlanBlock({ task, planner }: PartProps): ReactNode {
  const confirming = useRecordChange(task, (plan: string) => confirmPlan(task.id, plan));
  const [editing, setEditing] = useState(false);
  const written = task.plan !== "";
  return (
    <RecordBlock
      icon="map"
      title="Plan"
      actions={
        !editing && (
          <PartActions
            task={task}
            planner={planner}
            written={written}
            confirmed={task.planConfirmed}
            confirming={confirming.isPending}
            onConfirm={() => confirming.mutate(task.plan)}
            onEdit={() => setEditing(true)}
          />
        )
      }
    >
      {confirming.error && <RefusalAlert title="The Plan wasn't saved" error={confirming.error} />}
      {editing ? (
        <PartEditor
          label="Plan"
          hint="How the Task will be implemented, in Markdown."
          initial={task.plan}
          saving={confirming.isPending}
          onSave={(text) => confirming.mutate(text, { onSuccess: () => setEditing(false) })}
          onCancel={() => setEditing(false)}
        />
      ) : written ? (
        <p className="task-plan">{task.plan}</p>
      ) : (
        <p className="task-quiet">No Plan yet.</p>
      )}
    </RecordBlock>
  );
}

/**
 * The Pipeline the Planner proposes, with why, until the user takes it, keeps the one the Task
 * follows or chooses another from the library; each ends the proposal.
 */
export function ProposedPipeline({
  task,
  pipeline,
  planner,
}: {
  readonly task: Task;
  /** The Pipeline the Task follows now. */
  readonly pipeline: Pipeline | undefined;
  readonly planner: string;
}): ReactNode {
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
      {NOT_STARTED.includes(task.state) && (
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
      )}
      {choosing.error && <RefusalAlert title="The Pipeline wasn't set" error={choosing.error} />}
    </div>
  );
}

/** Where a part stands, and Confirm and Edit while the Task hasn't started. */
function PartActions({
  task,
  planner,
  written,
  confirmed,
  confirming,
  onConfirm,
  onEdit,
}: {
  readonly task: Task;
  readonly planner: string;
  readonly written: boolean;
  readonly confirmed: boolean;
  readonly confirming: boolean;
  readonly onConfirm: () => void;
  readonly onEdit: () => void;
}): ReactNode {
  const editable = NOT_STARTED.includes(task.state);
  return (
    <div className="task-part-actions">
      {written &&
        (confirmed ? (
          <Badge tone="success">Confirmed</Badge>
        ) : (
          <Badge tone="warning">Proposed by {planner}</Badge>
        ))}
      {editable && written && !confirmed && (
        <Button size="sm" loading={confirming} onClick={onConfirm}>
          Confirm
        </Button>
      )}
      {editable && (
        <Button size="sm" variant="secondary" disabled={confirming} onClick={onEdit}>
          Edit
        </Button>
      )}
    </div>
  );
}

/** The user's own version of a part; saving it confirms it. */
function PartEditor({
  label,
  hint,
  initial,
  saving,
  onSave,
  onCancel,
}: {
  readonly label: string;
  readonly hint: string;
  readonly initial: string;
  readonly saving: boolean;
  readonly onSave: (text: string) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [text, setText] = useState(initial);
  return (
    <form
      className="task-part-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text);
      }}
    >
      <Textarea
        aria-label={label}
        hint={hint}
        rows={6}
        value={text}
        onChange={(event) => setText(event.target.value)}
        autoFocus
      />
      <div className="task-part-actions">
        <Button size="sm" type="submit" loading={saving} iconLeft={<Icon name="check" size={14} />}>
          Save and confirm
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A change to the Task's record from its page: the answer replaces the shown Task at once. */
function useRecordChange<Value>(
  task: Task,
  change: (value: Value) => Promise<Task>,
): UseMutationResult<Task, Error, Value> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: (changed) => queryClient.setQueryData(taskQueries.one(task.id).queryKey, changed),
    onSettled: () => queryClient.invalidateQueries(taskQueries.list()),
  });
}
