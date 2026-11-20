import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Initiative, NewTask, Project, Task, TaskKind } from "@the-office/contracts";
import { Button, Checkbox, Dialog, Field, Input, RadioGroup } from "@the-office/ui";
import { useId, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { projectQueries } from "../../api/projects.ts";
import { addTaskToInitiative, createTask, initiativeQueries, taskQueries } from "../../api/work.ts";
import { attachAll, type PendingAttachment } from "../attachments/pending-attachment.ts";
import { PendingAttachmentsField } from "../attachments/pending-attachments-field.tsx";
import { MentionField } from "../mentions/mention-field.tsx";
import { useMentions, type Mentions } from "../mentions/mention-picker.tsx";
import { ProjectChip } from "../project-chip.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { tagsInUse } from "./tag-words.ts";
import { TagsInput } from "./tags-input.tsx";
import { focusBugOutline, KindField } from "./kind-field.tsx";
import { BUG_DESCRIPTION_OUTLINE, descriptionForKind, TASK_STATE_NAMES } from "./work-words.ts";
import "./new-task-dialog.css";

/** A new Task as the user writes it; no Project until one is chosen. */
export type NewTaskDraft = Omit<NewTask, "projectId" | "description" | "kind"> & {
  readonly projectId?: string;
  readonly description: string;
  readonly kind: TaskKind;
};

export const EMPTY_TASK_DRAFT: NewTaskDraft = {
  title: "",
  description: "",
  priority: "normal",
  tags: [],
  kind: "feature",
};

/** Where a new Task goes: the Project it starts in, and the Initiative it is added to, if any. */
interface NewTaskPlace {
  readonly projectId?: string | null;
  readonly initiative?: Initiative;
  readonly canWaitFor?: readonly Task[];
}

/** New Task's state, its fields' and its submit's, held by the window it shows in. */
export interface NewTaskForm {
  readonly formId: string;
  readonly initiative: Initiative | undefined;
  readonly canWaitFor: readonly Task[];
  readonly draft: NewTaskDraft;
  readonly onChange: Dispatch<SetStateAction<NewTaskDraft>>;
  readonly pending: readonly PendingAttachment[];
  readonly onPendingChange: Dispatch<SetStateAction<readonly PendingAttachment[]>>;
  /** The Project it is added in: the one chosen, else where it starts. */
  readonly projectId: string | undefined;
  readonly projects: readonly Project[] | undefined;
  readonly blockedBy: ReadonlySet<string>;
  readonly setBlockedBy: (blockedBy: ReadonlySet<string>) => void;
  readonly mentions: Mentions;
  readonly creating: UseMutationResult<Task, Error, NewTask>;
  readonly added: Task | undefined;
  readonly unsavedChanges: boolean;
}

/**
 * Adds a Task: a title, a Description and Attachments if the user wants, its Project and any Tags;
 * it starts in Backlog, in `projectId` unless another is chosen (else the first Project), and its
 * page opens, the Attachments added to it in the order chosen. Given an Initiative, it is "Add a
 * Task" there (prototypes/app/work.js `new-task`): in the Initiative's first Project unless another
 * is chosen (else `projectId`, the Project of the Idea it was shaped from, until it has Tasks), and
 * waiting for any of `canWaitFor`, the Initiative's Tasks that can still hold it back, the user
 * chooses; it starts in Shaping while the Initiative does, and the user stays on the Initiative to
 * add the next. The draft and the Attachments are the caller's, so Create can keep them while the
 * user switches to an Idea.
 */
export function useNewTask({
  projectId: startingProjectId = null,
  initiative,
  canWaitFor = [],
  draft,
  onChange,
  pending,
  onPendingChange,
  onClose,
}: NewTaskPlace & {
  readonly draft: NewTaskDraft;
  readonly onChange: Dispatch<SetStateAction<NewTaskDraft>>;
  readonly pending: readonly PendingAttachment[];
  readonly onPendingChange: Dispatch<SetStateAction<readonly PendingAttachment[]>>;
  readonly onClose: () => void;
}): NewTaskForm {
  const formId = useId();
  const projects = useQuery(projectQueries.list());
  const mentions = useMentions(draft.description, (description) =>
    onChange((current) => ({ ...current, description })),
  );
  const [blockedBy, setBlockedBy] = useState<ReadonlySet<string>>(new Set());
  const projectId =
    draft.projectId ?? initiative?.projectIds[0] ?? startingProjectId ?? projects.data?.[0]?.id;
  const queryClient = useQueryClient();
  const showToast = useToast();
  const navigate = useNavigate();
  // Once added, a failed Attachment is tried again without adding the Task twice.
  const [added, setAdded] = useState<Task>();
  const creating = useMutation({
    mutationFn: async (newTask: NewTask) => {
      const task =
        added ??
        (await (initiative
          ? addTaskToInitiative(initiative.id, { ...newTask, blockedBy: [...blockedBy] })
          : createTask(newTask)));
      setAdded(task);
      await attachAll({ kind: "task", taskId: task.id }, pending, () =>
        onPendingChange((left) => left.slice(1)),
      );
      return task;
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(taskQueries.list()),
        initiative && queryClient.invalidateQueries(initiativeQueries.list()),
      ]),
    onSuccess: async (task) => {
      showToast(`${task.title} is in ${TASK_STATE_NAMES[task.state]}.`);
      onClose();
      if (!initiative) await navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });
    },
  });
  return {
    formId,
    initiative,
    canWaitFor,
    draft,
    onChange,
    pending,
    onPendingChange,
    projectId,
    projects: projects.data,
    blockedBy,
    setBlockedBy,
    mentions,
    creating,
    added,
    // Choices and pasted Attachments come with no field's input, so they are counted here.
    unsavedChanges:
      draft.title !== "" ||
      draft.description !== "" ||
      draft.projectId !== undefined ||
      draft.kind !== EMPTY_TASK_DRAFT.kind ||
      (draft.tags?.length ?? 0) > 0 ||
      pending.length > 0 ||
      blockedBy.size > 0,
  };
}

/** "New Task", or "Add a Task" on an Initiative's page. */
export function NewTaskDialog({
  onClose,
  ...place
}: NewTaskPlace & { readonly onClose: () => void }): ReactNode {
  const [draft, setDraft] = useState(EMPTY_TASK_DRAFT);
  const [pending, setPending] = useState<readonly PendingAttachment[]>([]);
  const form = useNewTask({
    ...place,
    draft,
    onChange: setDraft,
    pending,
    onPendingChange: setPending,
    onClose,
  });
  return (
    <Dialog
      size="medium"
      title={form.initiative ? `Add a Task to ${form.initiative.name}` : "New Task"}
      unsavedChanges={form.unsavedChanges}
      onClose={onClose}
      actions={<NewTaskActions form={form} />}
    >
      <NewTaskBody form={form} />
    </Dialog>
  );
}

/** New Task's submit, with where the Task starts. */
export function NewTaskActions({ form }: { readonly form: NewTaskForm }): ReactNode {
  return (
    <>
      <Button
        type="submit"
        form={form.formId}
        loading={form.creating.isPending}
        disabled={form.projectId === undefined}
      >
        Add the Task
      </Button>
      <span className="dialog-hint">
        {form.initiative?.state === "shaping"
          ? "It starts in Shaping, and moves to Backlog once the Initiative is confirmed."
          : "It starts in Backlog."}
      </span>
    </>
  );
}

/** New Task's fields. */
export function NewTaskBody({ form }: { readonly form: NewTaskForm }): ReactNode {
  const tasks = useQuery(taskQueries.list());
  const { draft, onChange, projectId, projects, creating, mentions } = form;
  const descriptionId = `${form.formId}-description`;
  return (
    <form
      id={form.formId}
      className="dialog-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (projectId === undefined) return;
        creating.mutate({ ...draft, description: mentions.linked(draft.description), projectId });
      }}
    >
      {creating.error && (
        <RefusalAlert
          title={
            form.added
              ? "The Task is added, but not every Attachment yet"
              : "The Task can't be added"
          }
          error={creating.error}
        />
      )}
      <Input
        label="Title"
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        autoFocus
      />
      <KindField
        value={draft.kind}
        onChange={(kind) => {
          const description = descriptionForKind(draft.description, draft.kind, kind);
          onChange({ ...draft, kind, description });
          if (description === BUG_DESCRIPTION_OUTLINE && draft.description !== description) {
            focusBugOutline(descriptionId);
          }
        }}
      />
      <MentionField
        id={descriptionId}
        label="Description"
        hint={
          draft.kind === "bug" && draft.description === BUG_DESCRIPTION_OUTLINE
            ? "Optional. Choosing Bug filled in this outline because the Description was empty. Edit it freely."
            : "Optional. What you want, in your own words; type @ to mention a Task, Initiative, Decision or Idea. The title alone is enough to plan from."
        }
        rows={draft.kind === "bug" ? 8 : 4}
        value={draft.description}
        onChange={(description) => onChange({ ...draft, description })}
        mentions={mentions}
      />
      <PendingAttachmentsField pending={form.pending} onChange={form.onPendingChange} />
      <Field label="Project">
        {projects?.length === 0 ? (
          <p className="dialog-hint">Add a Project first: a Task belongs to one.</p>
        ) : (
          <RadioGroup
            options={(projects ?? []).map((project) => ({
              value: project.id,
              label: <ProjectChip projectId={project.id} projects={projects} />,
            }))}
            value={projectId}
            onChange={(value) => onChange({ ...draft, projectId: value })}
          />
        )}
      </Field>
      <Field label="Tags" hint="Optional. Words to find it by, such as its area.">
        <TagsInput
          tags={draft.tags ?? []}
          suggestions={tagsInUse(tasks.data ?? [])}
          onChange={(tags) => onChange({ ...draft, tags: [...tags] })}
        />
      </Field>
      {form.canWaitFor.length > 0 && (
        <MustWaitFor
          candidates={form.canWaitFor}
          projects={projects}
          chosen={form.blockedBy}
          onChange={form.setBlockedBy}
        />
      )}
    </form>
  );
}

/** The Initiative's Tasks the new one can wait for; it waits for none unless chosen. */
function MustWaitFor({
  candidates,
  projects,
  chosen,
  onChange,
}: {
  readonly candidates: readonly Task[];
  readonly projects: readonly Project[] | undefined;
  readonly chosen: ReadonlySet<string>;
  readonly onChange: (chosen: ReadonlySet<string>) => void;
}): ReactNode {
  const toggle = (taskId: string, checked: boolean): void => {
    const next = new Set(chosen);
    if (checked) next.add(taskId);
    else next.delete(taskId);
    onChange(next);
  };
  return (
    <Field label="Must wait for" hint="Optional. It can't start until each one chosen is Done.">
      <div className="must-wait-for" role="group" aria-label="Must wait for">
        {candidates.map((task) => (
          <Checkbox
            key={task.id}
            checked={chosen.has(task.id)}
            onChange={(checked) => toggle(task.id, checked)}
            label={
              <span className="must-wait-for-task">
                <ProjectChip projectId={task.projectId} projects={projects} />
                {task.title}
              </span>
            }
          />
        ))}
      </div>
    </Field>
  );
}
