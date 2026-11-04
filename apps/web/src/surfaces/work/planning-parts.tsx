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
import {
  confirmDefinitionOfDone,
  confirmPlan,
  setPipeline,
  taskQueries,
  type PlanConfirmation,
} from "../../api/work.ts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { DefinitionOfDoneStatements, ReportedMetBadge } from "./definition-of-done-statements.tsx";
import { PartEditor } from "./part-editor.tsx";
import { definitionOfDoneSummary, planSummary, statementsOf } from "./planning-words.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold, type Fold } from "./record-folds.ts";

/**
 * The Plan and the Definition of Done the Planner writes are proposed until the user confirms
 * them as shown or saves an edit; both stay editable until the Task starts. They start open while
 * the Task is in Planning, where the user reads them.
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
  const fold = usePartFold(task, "definition-of-done");
  const reportedMet = useQuery(pipelineQueries.taskStages(task.id)).data?.definitionOfDoneMet ?? [];
  const started = !NOT_STARTED.includes(task.state);
  const written = task.definitionOfDone.length > 0;
  return (
    <RecordFold
      fold={fold}
      icon="list-checks"
      title="Definition of Done"
      summary={definitionOfDoneSummary(task, reportedMet)}
      side={
        started && written ? (
          <ReportedMetBadge statements={task.definitionOfDone} met={reportedMet} />
        ) : (
          !editing && (
            <PartActions
              task={task}
              planner={planner}
              written={written}
              confirmed={task.definitionOfDoneConfirmed}
              confirming={confirming.isPending}
              onConfirm={() => confirming.mutate(task.definitionOfDone, { onError: fold.open })}
              onEdit={() => {
                fold.open();
                setEditing(true);
              }}
            />
          )
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
          saveLabel="Save and confirm"
          saving={confirming.isPending}
          onSave={(text) =>
            confirming.mutate(statementsOf(text), { onSuccess: () => setEditing(false) })
          }
          onCancel={() => setEditing(false)}
        />
      ) : written ? (
        <DefinitionOfDoneStatements
          statements={task.definitionOfDone}
          met={started ? reportedMet : undefined}
        />
      ) : (
        <p className="task-quiet">
          Not written yet. {planner} proposes it during planning; a Task can't be Ready without one.
        </p>
      )}
    </RecordFold>
  );
}

export function PlanBlock({ task, planner }: PartProps): ReactNode {
  const confirming = useRecordChange(task, (plan: PlanConfirmation) => confirmPlan(task.id, plan));
  const [editing, setEditing] = useState(false);
  const fold = usePartFold(task, "plan");
  const written = task.plan !== "";
  return (
    <RecordFold
      fold={fold}
      icon="map"
      title="Plan"
      summary={planSummary(task)}
      side={
        !editing && (
          <PartActions
            task={task}
            planner={planner}
            written={written}
            confirmed={task.planConfirmed}
            confirming={confirming.isPending}
            onConfirm={() =>
              confirming.mutate(
                { plan: task.plan, filesToChange: [...task.filesToChange] },
                { onError: fold.open },
              )
            }
            onEdit={() => {
              fold.open();
              setEditing(true);
            }}
          />
        )
      }
    >
      {confirming.error && <RefusalAlert title="The Plan wasn't saved" error={confirming.error} />}
      {editing ? (
        <PlanEditor
          task={task}
          saving={confirming.isPending}
          onSave={(plan) => confirming.mutate(plan, { onSuccess: () => setEditing(false) })}
          onCancel={() => setEditing(false)}
        />
      ) : written ? (
        <>
          <div className="task-plan-text">
            <MarkdownText text={task.plan} />
          </div>
          <FilesToChange files={task.filesToChange} />
          <PlannersEstimate estimatedTokens={task.estimatedTokens} />
        </>
      ) : (
        <p className="task-quiet">No Plan yet.</p>
      )}
    </RecordFold>
  );
}

function usePartFold(task: Task, block: string): Fold {
  return useFold({ kind: "task", id: task.id }, block, task.state === "planning");
}

/** The Planner's token estimate for the whole Pipeline, the Usage estimate below 3 done Tasks. */
function PlannersEstimate({
  estimatedTokens,
}: {
  readonly estimatedTokens: number | null;
}): ReactNode {
  if (estimatedTokens === null) return null;
  return (
    <p className="task-quiet">
      The Planner expects the whole Pipeline to use about {tokensShort(estimatedTokens)} tokens.
    </p>
  );
}

/** The files and folders the Plan expects to change, which Start weighs Overlaps on. */
function FilesToChange({ files }: { readonly files: readonly string[] }): ReactNode {
  if (files.length === 0) return null;
  return (
    <section className="task-files-to-change" aria-label="Files to change">
      <div className="task-dependencies-label">Files to change</div>
      <ul>
        {files.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The user's own Plan and the files it expects to change, saved and confirmed together. */
function PlanEditor({
  task,
  saving,
  onSave,
  onCancel,
}: {
  readonly task: Task;
  readonly saving: boolean;
  readonly onSave: (plan: PlanConfirmation) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [plan, setPlan] = useState(task.plan);
  const [files, setFiles] = useState(task.filesToChange.join("\n"));
  return (
    <form
      className="task-part-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ plan, filesToChange: statementsOf(files) });
      }}
    >
      <Textarea
        aria-label="Plan"
        hint="How the Task will be implemented, in Markdown."
        rows={6}
        value={plan}
        onChange={(event) => setPlan(event.target.value)}
        autoFocus
      />
      <Textarea
        aria-label="Files to change"
        hint="One path per line, from the repository's root; a folder covers the files under it."
        rows={3}
        value={files}
        onChange={(event) => setFiles(event.target.value)}
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

/** A change to the Task's record from its page: the answer replaces the shown Task at once. */
export function useRecordChange<Value>(
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
