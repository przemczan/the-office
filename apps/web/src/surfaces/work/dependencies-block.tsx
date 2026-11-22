import { useQuery } from "@tanstack/react-query";
import type { Project, TaskSummary } from "@the-office/contracts";
import { Button, Dialog, Icon, IconButton, Input, RadioGroup } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { addDependency, removeDependency, useEveryTask } from "../../api/work.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { blockersOf } from "../../shell/work/initiative-progress.ts";
import { blockerCandidates, waitingFor } from "./dependency-words.ts";
import { useRecordChange } from "./planning-parts.tsx";

/** The Tasks this one waits for and the Tasks waiting for it, in any Project. */
export function useDependencies(task: TaskSummary): {
  readonly blockers: readonly TaskSummary[];
  readonly waiting: readonly TaskSummary[];
} {
  const tasks = useEveryTask().data ?? [];
  return { blockers: blockersOf(task, tasks), waiting: waitingFor(task, tasks) };
}

/**
 * What the Task must wait for and what waits for it, in any Project (prototypes/app/task.js
 * `dependencies`), as a section of the Description block. Its blockers are set before it starts;
 * once started, the section shows only when there is something to show.
 */
export function DependenciesSection({ task }: { readonly task: TaskSummary }): ReactNode {
  const tasks = useEveryTask().data ?? [];
  const projects = useQuery(projectQueries.list()).data;
  const [adding, setAdding] = useState(false);
  const removing = useRecordChange(task, (blockerId: string) =>
    removeDependency(task.id, blockerId),
  );
  const showToast = useToast();
  const changeable = NOT_STARTED.includes(task.state);
  const { blockers, waiting } = useDependencies(task);
  if (!changeable && blockers.length === 0 && waiting.length === 0) return null;
  return (
    <section className="task-record-section" aria-label="Dependencies">
      <div className="task-record-section-head">
        <h3 className="task-record-section-title">Dependencies</h3>
        {changeable && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            Add
          </Button>
        )}
      </div>
      {blockers.length === 0 && waiting.length === 0 && (
        <p className="task-quiet">It waits for no Task, and none waits for it.</p>
      )}
      {blockers.length > 0 && (
        <TaskList label="Must be Done first" tasks={blockers} projects={projects}>
          {(blocker) =>
            changeable && (
              <IconButton
                icon={<Icon name="x" size={14} />}
                label={`Stop waiting for ${blocker.title}`}
                size="xs"
                disabled={removing.isPending}
                onClick={() =>
                  removing.mutate(blocker.id, { onError: (error) => showToast(error.message) })
                }
              />
            )
          }
        </TaskList>
      )}
      {waiting.length > 0 && (
        <TaskList label="Waiting for this Task" tasks={waiting} projects={projects} />
      )}
      {adding && (
        <AddDependencyDialog
          task={task}
          candidates={blockerCandidates(task, tasks)}
          projects={projects}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}

/** Tasks under an overline, each linking to its page with its Project and state. */
export function TaskList({
  label,
  tasks,
  projects,
  children,
}: {
  readonly label: string;
  readonly tasks: readonly TaskSummary[];
  readonly projects: readonly Project[] | undefined;
  /** What a row can do, at its end. */
  readonly children?: (task: TaskSummary) => ReactNode;
}): ReactNode {
  return (
    <section className="task-dependencies" aria-label={label}>
      <div className="task-dependencies-label">{label}</div>
      <ul className="task-dependencies-list">
        {tasks.map((each) => (
          <li key={each.id}>
            <TaskProject task={each} projects={projects} />
            <Link
              to="/tasks/$taskId"
              params={{ taskId: each.id }}
              className="task-dependencies-title"
            >
              {each.title}
            </Link>
            <TaskStateBadge state={each.state} />
            {children?.(each)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Any Task in any Project the Task could wait for, found by its title. */
function AddDependencyDialog({
  task,
  candidates,
  projects,
  onClose,
}: {
  readonly task: TaskSummary;
  readonly candidates: readonly TaskSummary[];
  readonly projects: readonly Project[] | undefined;
  readonly onClose: () => void;
}): ReactNode {
  const adding = useRecordChange(task, (blockerId: string) => addDependency(task.id, blockerId));
  return (
    <TaskPickerDialog
      title="What must be Done first?"
      text={`${task.title} can't start until the Task chosen here is Done. It can be in any Project.`}
      candidates={candidates}
      projects={projects}
      noCandidates="No other Task can hold it back: the rest are Done, Dropped, or already wait for it."
      refusalTitle="It can't wait for that Task"
      pending={adding.isPending}
      error={adding.error}
      onPick={(blockerId) => adding.mutate(blockerId, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}

/**
 * A window to pick one Task of `candidates`, in any Project, found by its title: Dependencies'
 * Add, and a Bug's Caused by. `onPick` takes the Task's id, and closes the window once it is done.
 */
export function TaskPickerDialog({
  title,
  text,
  candidates,
  projects,
  noCandidates,
  refusalTitle,
  pending,
  error,
  onPick,
  onClose,
}: {
  readonly title: string;
  readonly text: string;
  readonly candidates: readonly TaskSummary[];
  readonly projects: readonly Project[] | undefined;
  /** What the window says when no Task can be picked. */
  readonly noCandidates: string;
  readonly refusalTitle: string;
  readonly pending: boolean;
  /** Why the pick was refused, if it was. */
  readonly error: Error | null;
  readonly onPick: (taskId: string) => void;
  readonly onClose: () => void;
}): ReactNode {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string>();
  const words = search.trim().toLowerCase();
  const found = candidates.filter(({ title: each }) => each.toLowerCase().includes(words));
  // A choice the search hides is no longer what the user sees chosen.
  const chosenId = found.some(({ id }) => id === chosen) ? chosen : undefined;
  return (
    <Dialog
      size="medium"
      title={title}
      unsavedChanges={chosenId !== undefined}
      onClose={onClose}
      actions={
        <Button
          loading={pending}
          disabled={chosenId === undefined}
          onClick={() => {
            if (chosenId !== undefined) onPick(chosenId);
          }}
        >
          Add
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">{text}</p>
        {error && <RefusalAlert title={refusalTitle} error={error} />}
        {candidates.length === 0 ? (
          <p className="task-quiet">{noCandidates}</p>
        ) : (
          <>
            <Input
              aria-label="Find a Task"
              placeholder="Find a Task by its title"
              iconLeft={<Icon name="search" size={14} />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {found.length === 0 ? (
              <p className="task-quiet">No Task's title has “{search.trim()}”.</p>
            ) : (
              <RadioGroup
                options={found.map((candidate) => ({
                  value: candidate.id,
                  label: (
                    <span className="task-dependencies-option">
                      <TaskProject task={candidate} projects={projects} />
                      {candidate.title}
                    </span>
                  ),
                }))}
                value={chosenId}
                onChange={setChosen}
              />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function TaskProject({
  task,
  projects,
}: {
  readonly task: TaskSummary;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const project = projects?.find(({ id }) => id === task.projectId);
  return project ? <ProjectMark project={project} /> : null;
}
