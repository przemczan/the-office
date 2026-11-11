import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { Badge, Button, Icon, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import {
  changeDescription,
  confirmDefinitionOfDone,
  confirmPlan,
  saveDefinitionOfDone,
  savePlan,
  taskQueries,
  type PlanSaving,
} from "../../api/work.ts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { DefinitionOfDoneStatements, ReportedMetBadge } from "./definition-of-done-statements.tsx";
import { PartEditor } from "./part-editor.tsx";
import {
  definitionOfDoneSummary,
  descriptionSummary,
  NO_DESCRIPTION,
  planSummary,
  leavesReadyWords,
  statementsOf,
} from "./planning-words.ts";
import { useQueued } from "./queue-parts.tsx";
import { recordBlockElementId, type PartBlock } from "./record-blocks.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold, type Fold } from "./record-folds.ts";

/**
 * The user's Description: what they want, in their own words, which the Planner plans from. It
 * stays editable until the Task starts, and starts open until then, where it is read.
 */
export function DescriptionBlock({ task }: { readonly task: Task }): ReactNode {
  const changing = useRecordChange(task, (description: string) =>
    changeDescription(task.id, description),
  );
  const [editing, setEditing] = useState(false);
  const editable = NOT_STARTED.includes(task.state);
  const fold = useFold({ kind: "task", id: task.id }, "description", editable);
  return (
    <RecordFold
      fold={fold}
      icon="align-left"
      title="Description"
      summary={descriptionSummary(task)}
      side={
        editable &&
        !editing && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              fold.open();
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )
      }
    >
      {changing.error && (
        <RefusalAlert title="The Description wasn't saved" error={changing.error} />
      )}
      {editing ? (
        <PartEditor
          label="Description"
          hint="What you want, in your own words, in Markdown; type @ to mention a Task, Initiative, Decision or Idea. The title alone is enough to plan from."
          initial={task.description}
          mentions
          saving={changing.isPending}
          onSave={(text) => changing.mutate(text, { onSuccess: () => setEditing(false) })}
          onCancel={() => setEditing(false)}
        />
      ) : task.description === "" ? (
        <p className="task-quiet">{NO_DESCRIPTION}</p>
      ) : (
        <div className="task-plan-text">
          <MarkdownText text={task.description} />
        </div>
      )}
    </RecordFold>
  );
}

/**
 * The Plan and the Definition of Done, written by the Planner or the user, are not confirmed until
 * the user confirms them as they read; both stay editable until the Task starts, and saving a change
 * leaves the part unconfirmed. They start open while the Task is in Planning, where the user reads
 * them.
 */
interface PartProps {
  readonly task: Task;
  /** The Planner's name, for the words of a part not written yet. */
  readonly planner: string;
}

export function DefinitionOfDoneBlock({ task, planner }: PartProps): ReactNode {
  const saving = useRecordChange(task, (statements: readonly string[]) =>
    saveDefinitionOfDone(task.id, statements),
  );
  const confirming = useRecordChange<void>(task, () => confirmDefinitionOfDone(task.id));
  const [editing, setEditing] = useState(false);
  const fold = usePartFold(task, "definition-of-done");
  const reportedMet = useQuery(pipelineQueries.taskStages(task.id)).data?.definitionOfDoneMet ?? [];
  const started = !NOT_STARTED.includes(task.state);
  const written = task.definitionOfDone.length > 0;
  return (
    <RecordFold
      id={recordBlockElementId("definition-of-done")}
      fold={fold}
      icon="check"
      title="Definition of Done"
      summary={definitionOfDoneSummary(task, reportedMet)}
      side={
        started && written ? (
          <ReportedMetBadge statements={task.definitionOfDone} met={reportedMet} />
        ) : (
          !editing && (
            <PartActions
              task={task}
              written={written}
              confirmed={task.definitionOfDoneConfirmed}
              confirming={confirming.isPending}
              onConfirm={() => confirming.mutate()}
              onEdit={() => {
                fold.open();
                setEditing(true);
              }}
            />
          )
        )
      }
    >
      {saving.error && (
        <RefusalAlert title="The Definition of Done wasn't saved" error={saving.error} />
      )}
      {confirming.error && (
        <RefusalAlert title="The Definition of Done wasn't confirmed" error={confirming.error} />
      )}
      {editing ? (
        <PartEditor
          label="Definition of Done"
          hint="One statement per line: what must be true when the Task is done."
          initial={task.definitionOfDone.join("\n")}
          note={<LeavesReadyNote task={task} />}
          saving={saving.isPending}
          onSave={(text) =>
            saving.mutate(statementsOf(text), { onSuccess: () => setEditing(false) })
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
          {task.state === "shaping"
            ? `Not written yet. ${WRITTEN_ONCE_CONFIRMED}`
            : `Not written yet. ${planner} proposes it while planning, or write it yourself; a Task can't be Ready without one.`}
        </p>
      )}
    </RecordFold>
  );
}

export function PlanBlock({ task, planner }: PartProps): ReactNode {
  const saving = useRecordChange(task, (plan: PlanSaving) => savePlan(task.id, plan));
  const confirming = useRecordChange<void>(task, () => confirmPlan(task.id));
  const [editing, setEditing] = useState(false);
  const fold = usePartFold(task, "plan");
  const written = task.plan !== "";
  return (
    <RecordFold
      id={recordBlockElementId("plan")}
      fold={fold}
      icon="file"
      title="Plan"
      summary={planSummary(task)}
      side={
        !editing && (
          <PartActions
            task={task}
            written={written}
            confirmed={task.planConfirmed}
            confirming={confirming.isPending}
            onConfirm={() => confirming.mutate()}
            onEdit={() => {
              fold.open();
              setEditing(true);
            }}
          />
        )
      }
    >
      {saving.error && <RefusalAlert title="The Plan wasn't saved" error={saving.error} />}
      {confirming.error && (
        <RefusalAlert title="The Plan wasn't confirmed" error={confirming.error} />
      )}
      {editing ? (
        <PlanEditor
          task={task}
          saving={saving.isPending}
          onSave={(plan) => saving.mutate(plan, { onSuccess: () => setEditing(false) })}
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
        <p className="task-quiet">No Plan yet. {noPlanWords(task.state, planner)}</p>
      )}
    </RecordFold>
  );
}

function noPlanWords(state: Task["state"], planner: string): string {
  if (state === "shaping") return WRITTEN_ONCE_CONFIRMED;
  return state === "backlog"
    ? `Make a plan with ${planner} from the conversation, or write it yourself.`
    : `${planner} proposes it while planning, or write it yourself.`;
}

const WRITTEN_ONCE_CONFIRMED = "It is written once the Initiative is confirmed.";

/** Where a part is confirmed: Ready waits for it. */
const BEFORE_READY: readonly Task["state"][] = ["backlog", "planning"];

/** Where a part is edited: not in Shaping, which waits for the Initiative's Confirm. */
const PARTS_EDITED_IN: readonly Task["state"][] = ["backlog", "planning", "ready"];

function usePartFold(task: Task, block: PartBlock): Fold {
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

/** The user's own Plan and the files it expects to change, saved together. */
function PlanEditor({
  task,
  saving,
  onSave,
  onCancel,
}: {
  readonly task: Task;
  readonly saving: boolean;
  readonly onSave: (plan: PlanSaving) => void;
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
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <LeavesReadyNote task={task} />
      </div>
    </form>
  );
}

/**
 * Beside Save while the Task is Ready: a change leaves a part unconfirmed, so it can't stay Ready,
 * and goes back to Planning, or to Backlog when it was never planned.
 */
function LeavesReadyNote({ task }: { readonly task: Task }): ReactNode {
  const queued = useQueued(task.id) !== undefined;
  if (task.state !== "ready") return null;
  return <p className="task-part-note">{leavesReadyWords(task, queued)}</p>;
}

/**
 * Where a part stands, with Confirm beside an unconfirmed one before Ready, and Edit while the
 * Task hasn't started. Confirm takes the part exactly as it reads.
 */
function PartActions({
  task,
  written,
  confirmed,
  confirming,
  onConfirm,
  onEdit,
}: {
  readonly task: Task;
  readonly written: boolean;
  readonly confirmed: boolean;
  readonly confirming: boolean;
  readonly onConfirm: () => void;
  readonly onEdit: () => void;
}): ReactNode {
  const editable = PARTS_EDITED_IN.includes(task.state);
  const confirmable = BEFORE_READY.includes(task.state);
  return (
    <div className="task-part-actions">
      {written &&
        (confirmed ? (
          <Badge tone="success">Confirmed</Badge>
        ) : (
          <>
            <Badge tone="warning">Not confirmed</Badge>
            {confirmable && (
              <Button size="sm" loading={confirming} onClick={onConfirm}>
                Confirm
              </Button>
            )}
          </>
        ))}
      {editable && (
        <Button size="sm" variant="secondary" onClick={onEdit}>
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
