import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, Task, TaskState } from "@the-office/contracts";
import { Alert, Button, Dialog, Field, RadioGroup, Skeleton } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, moveTask, taskQueries } from "../../api/work.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";

/**
 * Move: the Task goes to another Project. While the service refuses it, the window gives every
 * reason and only Close; otherwise it offers the other Projects and says what the Move does.
 */
export function MoveTaskDialog({
  task,
  onClose,
}: {
  readonly task: Task;
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const check = useQuery(taskQueries.moveCheck(task.id));
  const projects = useQuery(projectQueries.list());
  const others = (projects.data ?? []).filter(({ id }) => id !== task.projectId);
  const [chosen, setChosen] = useState<string | undefined>();
  const destination = others.find(({ id }) => id === chosen) ?? others[0];
  const moving = useMovingTask(task, onClose);
  const canMove = check.data?.problems.length === 0 && destination !== undefined;
  return (
    <Dialog
      size="medium"
      title={`Move ${task.title} to another Project`}
      onClose={onClose}
      actions={
        canMove && (
          <Button type="submit" form={formId} loading={moving.isPending}>
            Move
          </Button>
        )
      }
    >
      <form
        id={formId}
        className="work-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canMove) moving.mutate(destination);
        }}
      >
        {moving.error && <RefusalAlert title="The Task can't be moved" error={moving.error} />}
        {check.error && <RefusalAlert title="The Move can't be checked" error={check.error} />}
        {!check.data || !projects.data ? (
          !check.error && <Skeleton height={96} />
        ) : check.data.problems.length > 0 ? (
          <Alert tone="warning" title="This Task can't move to another Project">
            <ul className="refusal-reasons">
              {check.data.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Alert>
        ) : others.length === 0 ? (
          <p className="dialog-text">
            There is no other Project to move it to. Add one on the Projects page first.
          </p>
        ) : (
          <>
            <p className="dialog-text">
              It is in <ProjectChip projectId={task.projectId} projects={projects.data} /> now.
            </p>
            <Field label="Move it to">
              <RadioGroup
                options={others.map((project) => ({
                  value: project.id,
                  label: <ProjectChip projectId={project.id} projects={projects.data} />,
                }))}
                value={destination?.id}
                onChange={setChosen}
              />
            </Field>
            {destination && <WhatMovingDoes task={task} project={destination} />}
          </>
        )}
      </form>
    </Dialog>
  );
}

function useMovingTask(task: Task, onMoved: () => void) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: (project: Project) => moveTask(task.id, project.id),
    onSuccess: async (_moved, project) => {
      // The Initiative's Projects are its Tasks'.
      await Promise.all([
        queryClient.invalidateQueries(taskQueries.list()),
        queryClient.invalidateQueries(initiativeQueries.list()),
      ]);
      showToast(`${task.title} is in ${project.name} now.`);
      onMoved();
    },
  });
}

/** What the Move does to the Task, in the chosen Project. */
function WhatMovingDoes({
  task,
  project,
}: {
  readonly task: Task;
  readonly project: Project;
}): ReactNode {
  return (
    <ul className="dialog-text move-task-effects">
      <li>
        {`It has no Pipeline in ${project.name} until one is chosen, as its commands differ; Stages edited for this Task are set aside.`}
      </li>
      <li>{STATE_AFTER_MOVING[task.state] ?? "It stays in Backlog."}</li>
      <li>
        Its Plan and Definition of Done keep their words, both Not confirmed, as they were written
        for this Project.
      </li>
      <li>Its Initiative, dependencies, Attachments and Threads stay with it.</li>
    </ul>
  );
}

/** Where the Move leaves a Task by the state it is in; it stays in Backlog by default. */
const STATE_AFTER_MOVING: Partial<Record<TaskState, string>> = {
  shaping: "It stays in Shaping until its Initiative is confirmed.",
  ready: "It goes back to Backlog, and out of the queue if it waits there.",
};
