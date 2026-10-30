import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Initiative, NewTask, Project, Task } from "@the-office/contracts";
import { Button, Checkbox, Dialog, Field, Input, RadioGroup } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { addTaskToInitiative, createTask, initiativeQueries, taskQueries } from "../../api/work.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { onlyProjectShown } from "../../shell/project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { canHoldBack } from "./dependency-words.ts";
import { tasksOfInitiative } from "./initiative-words.ts";
import { tagsInUse } from "./tag-words.ts";
import { TagsInput } from "./tags-input.tsx";

type NewTaskDraft = Omit<NewTask, "projectId"> & { readonly projectId?: string };

/**
 * "+ Task": a title, its Project and any Tags; it starts in Backlog, and its page opens. Given an
 * Initiative, it is "Add a Task" there (prototypes/app/work.js `new-task`): in the Initiative's
 * first Project unless another is chosen, and waiting for any of its Tasks that can still hold it
 * back; the user stays on the Initiative to add the next. Otherwise it is in the one Project the
 * Project filter shows, or the first.
 */
export function NewTaskDialog({
  initiative,
  onClose,
}: {
  readonly initiative?: Initiative;
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const projects = useQuery(projectQueries.list());
  const tasks = useQuery(taskQueries.list());
  const [draft, setDraft] = useState<NewTaskDraft>({
    title: "",
    priority: "normal",
    tags: [],
  });
  const [blockedBy, setBlockedBy] = useState<ReadonlySet<string>>(new Set());
  const { filter } = useProjectFilter();
  const projectId =
    draft.projectId ??
    initiative?.projectIds[0] ??
    onlyProjectShown(filter) ??
    projects.data?.[0]?.id;
  const candidates =
    initiative && tasks.data ? tasksOfInitiative(initiative, tasks.data).filter(canHoldBack) : [];
  const queryClient = useQueryClient();
  const showToast = useToast();
  const navigate = useNavigate();
  const creating = useMutation({
    mutationFn: (newTask: NewTask) =>
      initiative
        ? addTaskToInitiative(initiative.id, { ...newTask, blockedBy: [...blockedBy] })
        : createTask(newTask),
    onSuccess: async (task) => {
      await Promise.all([
        queryClient.invalidateQueries(taskQueries.list()),
        initiative && queryClient.invalidateQueries(initiativeQueries.list()),
      ]);
      showToast(`${task.title} is in Backlog.`);
      onClose();
      if (!initiative) await navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });
    },
  });
  return (
    <Dialog
      title={initiative ? `Add a Task to ${initiative.name}` : "New Task"}
      width={520}
      onClose={onClose}
      actions={
        <>
          <span className="dialog-hint">It starts in Backlog.</span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            loading={creating.isPending}
            disabled={projectId === undefined}
          >
            Add the Task
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="work-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (projectId !== undefined) creating.mutate({ ...draft, projectId });
        }}
      >
        {creating.error && <RefusalAlert title="The Task can't be added" error={creating.error} />}
        <Input
          label="Title"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          hint="You describe the work when you plan it with the Planner."
          autoFocus
        />
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
        {candidates.length > 0 && (
          <MustWaitFor
            candidates={candidates}
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
