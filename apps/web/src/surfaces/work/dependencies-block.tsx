import { useQuery } from "@tanstack/react-query";
import type { Project, Task } from "@the-office/contracts";
import { Button, Dialog, Icon, IconButton, Input, RadioGroup } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { addDependency, removeDependency, taskQueries } from "../../api/work.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import { blockerCandidates, blockersOf, waitingFor } from "./dependency-words.ts";
import { useRecordChange } from "./planning-parts.tsx";
import { RecordBlock } from "./record-block.tsx";

/**
 * What the Task must wait for and what waits for it, in any Project (prototypes/app/task.js
 * `dependencies`). Its blockers are set before it starts; once started, the block shows only when
 * there is something to show.
 */
export function DependenciesBlock({ task }: { readonly task: Task }): ReactNode {
  const tasks = useQuery(taskQueries.list()).data ?? [];
  const projects = useQuery(projectQueries.list()).data;
  const [adding, setAdding] = useState(false);
  const removing = useRecordChange(task, (blockerId: string) =>
    removeDependency(task.id, blockerId),
  );
  const showToast = useToast();
  const changeable = NOT_STARTED.includes(task.state);
  const blockers = blockersOf(task, tasks);
  const waiting = waitingFor(task, tasks);
  if (!changeable && blockers.length === 0 && waiting.length === 0) return null;
  return (
    <RecordBlock
      icon="git-fork"
      title="Dependencies"
      actions={
        changeable && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            Add
          </Button>
        )
      }
    >
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
    </RecordBlock>
  );
}

/** Tasks under an overline, each linking to its page with its Project and state. */
function TaskList({
  label,
  tasks,
  projects,
  children,
}: {
  readonly label: string;
  readonly tasks: readonly Task[];
  readonly projects: readonly Project[] | undefined;
  /** What a row can do, at its end. */
  readonly children?: (task: Task) => ReactNode;
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
  readonly task: Task;
  readonly candidates: readonly Task[];
  readonly projects: readonly Project[] | undefined;
  readonly onClose: () => void;
}): ReactNode {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string>();
  const adding = useRecordChange(task, (blockerId: string) => addDependency(task.id, blockerId));
  const words = search.trim().toLowerCase();
  const found = candidates.filter(({ title }) => title.toLowerCase().includes(words));
  // A choice the search hides is no longer what the user sees chosen.
  const blockerId = found.some(({ id }) => id === chosen) ? chosen : undefined;
  return (
    <Dialog
      title="What must be Done first?"
      description={`${task.title} can't start until the Task chosen here is Done. It can be in any Project.`}
      width={520}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={adding.isPending}
            disabled={blockerId === undefined}
            onClick={() => {
              if (blockerId !== undefined) adding.mutate(blockerId, { onSuccess: onClose });
            }}
          >
            Add
          </Button>
        </>
      }
    >
      {adding.error && <RefusalAlert title="It can't wait for that Task" error={adding.error} />}
      {candidates.length === 0 ? (
        <p className="task-quiet">
          No other Task can hold it back: the rest are Done, Dropped, or already wait for it.
        </p>
      ) : (
        <div className="task-dependencies-choice">
          <Input
            aria-label="Find a Task"
            placeholder="Find a Task by its title"
            iconLeft={<Icon name="search" size={14} />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="task-dependencies-options">
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
                value={blockerId}
                onChange={setChosen}
              />
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function TaskProject({
  task,
  projects,
}: {
  readonly task: Task;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const project = projects?.find(({ id }) => id === task.projectId);
  return project ? <ProjectMark project={project} /> : null;
}
