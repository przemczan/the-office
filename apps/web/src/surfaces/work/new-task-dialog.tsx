import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NewTask } from "@the-office/contracts";
import { Button, Dialog, Field, Input, RadioGroup } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { createTask, taskQueries } from "../../api/work.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";

/** "+ Task": a title and its Project; it starts in Backlog. */
export function NewTaskDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const formId = useId();
  const projects = useQuery(projectQueries.list());
  const [draft, setDraft] = useState<Omit<NewTask, "projectId"> & { projectId?: string }>({
    title: "",
    priority: "normal",
  });
  const projectId = draft.projectId ?? projects.data?.[0]?.id;
  const queryClient = useQueryClient();
  const showToast = useToast();
  const creating = useMutation({
    mutationFn: createTask,
    onSuccess: async (task) => {
      await queryClient.invalidateQueries(taskQueries.list());
      showToast(`${task.title} is in Backlog.`);
      onClose();
    },
  });
  return (
    <Dialog
      title="New Task"
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
      </form>
    </Dialog>
  );
}
