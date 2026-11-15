import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Initiative, NewTask, Project, Task } from "@the-office/contracts";
import { Button, Checkbox, Dialog, Field, Input, RadioGroup } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { addTaskToInitiative, createTask, initiativeQueries, taskQueries } from "../../api/work.ts";
import { attachAll, type PendingAttachment } from "../attachments/pending-attachment.ts";
import { PendingAttachmentsField } from "../attachments/pending-attachments-field.tsx";
import { MentionField } from "../mentions/mention-field.tsx";
import { useMentions } from "../mentions/mention-picker.tsx";
import { ProjectChip } from "../project-chip.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";
import { tagsInUse } from "./tag-words.ts";
import { TagsInput } from "./tags-input.tsx";
import { TASK_STATE_NAMES } from "./work-words.ts";
import "./new-task-dialog.css";

type NewTaskDraft = Omit<NewTask, "projectId" | "description"> & {
  readonly projectId?: string;
  readonly description: string;
};

/**
 * The top bar's Create › Task: a title, a Description and Attachments if the user wants, its Project
 * and any Tags; it starts in Backlog, in `projectId` unless another is chosen (else the first
 * Project), and its page opens, the Attachments added to it in the order chosen. Given an
 * Initiative, it is "Add a Task" there (prototypes/app/work.js `new-task`): in the Initiative's
 * first Project unless another is chosen (else `projectId`, the Project of the Idea it was shaped
 * from, until it has Tasks), and waiting for any of `canWaitFor`, the Initiative's Tasks that can
 * still hold it back, the user chooses; it starts in Shaping while the Initiative does, and the user
 * stays on the Initiative to add the next.
 */
export function NewTaskDialog({
  projectId: startingProjectId = null,
  initiative,
  canWaitFor = [],
  onClose,
}: {
  readonly projectId?: string | null;
  readonly initiative?: Initiative;
  readonly canWaitFor?: readonly Task[];
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const projects = useQuery(projectQueries.list());
  const tasks = useQuery(taskQueries.list());
  const [draft, setDraft] = useState<NewTaskDraft>({
    title: "",
    description: "",
    priority: "normal",
    tags: [],
  });
  const mentions = useMentions(draft.description, (description) =>
    setDraft((current) => ({ ...current, description })),
  );
  const [blockedBy, setBlockedBy] = useState<ReadonlySet<string>>(new Set());
  const projectId =
    draft.projectId ?? initiative?.projectIds[0] ?? startingProjectId ?? projects.data?.[0]?.id;
  const queryClient = useQueryClient();
  const showToast = useToast();
  const navigate = useNavigate();
  const [pending, setPending] = useState<readonly PendingAttachment[]>([]);
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
        setPending((left) => left.slice(1)),
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
  return (
    <Dialog
      size="medium"
      title={initiative ? `Add a Task to ${initiative.name}` : "New Task"}
      onClose={onClose}
      actions={
        <>
          <Button
            type="submit"
            form={formId}
            loading={creating.isPending}
            disabled={projectId === undefined}
          >
            Add the Task
          </Button>
          <span className="dialog-hint">
            {initiative?.state === "shaping"
              ? "It starts in Shaping, and moves to Backlog once the Initiative is confirmed."
              : "It starts in Backlog."}
          </span>
        </>
      }
    >
      <form
        id={formId}
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
              added ? "The Task is added, but not every Attachment yet" : "The Task can't be added"
            }
            error={creating.error}
          />
        )}
        <Input
          label="Title"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          autoFocus
        />
        <MentionField
          label="Description"
          hint="Optional. What you want, in your own words; type @ to mention a Task, Initiative, Decision or Idea. The title alone is enough to plan from."
          rows={4}
          value={draft.description}
          onChange={(description) => setDraft({ ...draft, description })}
          mentions={mentions}
        />
        <PendingAttachmentsField pending={pending} onChange={setPending} />
        <Field label="Project">
          {projects.data?.length === 0 ? (
            <p className="dialog-hint">Add a Project first: a Task belongs to one.</p>
          ) : (
            <RadioGroup
              options={(projects.data ?? []).map((project) => ({
                value: project.id,
                label: <ProjectChip projectId={project.id} projects={projects.data} />,
              }))}
              value={projectId}
              onChange={(value) => setDraft({ ...draft, projectId: value })}
            />
          )}
        </Field>
        <Field label="Tags" hint="Optional. Words to find it by, such as its area or kind.">
          <TagsInput
            tags={draft.tags ?? []}
            suggestions={tagsInUse(tasks.data ?? [])}
            onChange={(tags) => setDraft({ ...draft, tags: [...tags] })}
          />
        </Field>
        {canWaitFor.length > 0 && (
          <MustWaitFor
            candidates={canWaitFor}
            projects={projects.data}
            chosen={blockedBy}
            onChange={setBlockedBy}
          />
        )}
      </form>
    </Dialog>
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
