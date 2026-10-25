import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, Task, TaskPlacement, TaskState } from "@the-office/contracts";
import { Alert, Icon } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import { useState, type DragEvent, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { placeTask, taskQueries } from "../../api/work.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { PriorityIcon, TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { NOT_STARTED, PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { TaskMenu } from "./task-menu.tsx";

interface Column {
  readonly key: string;
  readonly label: string;
  readonly states: readonly TaskState[];
  readonly hint: (planner: string) => string;
}

/** Waiting on you and Paused are In progress's side states; Dropped ends a Task like Done. */
const COLUMNS: readonly Column[] = [
  { key: "backlog", label: "Backlog", states: ["backlog"], hint: () => "Not planned yet" },
  {
    key: "planning",
    label: "Planning",
    states: ["planning"],
    hint: (planner) => `Plan and Definition of Done with ${planner}`,
  },
  { key: "ready", label: "Ready", states: ["ready"], hint: () => "Starting is your call" },
  {
    key: "in-progress",
    label: "In progress",
    states: ["in-progress", "waiting-on-you", "paused"],
    hint: () => "Agents work its Pipeline",
  },
  { key: "done", label: "Done", states: ["done", "dropped"], hint: () => "Done and dropped" },
];

const EDGES: Partial<Record<TaskState, string>> = {
  "in-progress": "edge-running",
  "waiting-on-you": "edge-decision",
  paused: "edge-paused",
  done: "edge-done",
  dropped: "edge-failed",
};

/** Where a dragged card would land: before a card, or at its column's end. */
type DropTarget = { readonly before: string } | { readonly endOf: string };

/**
 * Every Project's Tasks by state, each column by priority then manual order (the service's order).
 * A card that hasn't started drags within its column; dropped among another priority, it takes it.
 */
export function Board(): ReactNode {
  const tasks = useQuery(taskQueries.list());
  const projects = useQuery(projectQueries.list());
  const roles = useQuery(roleQueries.list());
  const [dragged, setDragged] = useState<Task>();
  const [target, setTarget] = useState<DropTarget>();
  const placing = usePlacing();
  const showToast = useToast();
  const planner = roles.data?.find((role) => role.key === "planner")?.card.name ?? "the Planner";

  const drop = (column: Column, event: DragEvent): void => {
    event.preventDefault();
    const task = dragged;
    setDragged(undefined);
    setTarget(undefined);
    if (!task || !tasks.data) return;
    if (!column.states.includes(task.state)) {
      showToast("A Task changes state through its actions: Plan, Mark Ready, Start.");
      return;
    }
    const others = tasks.data.filter(
      (other) => column.states.includes(other.state) && other.id !== task.id,
    );
    const before = cardUnder(event);
    const at = before === undefined ? others.length : others.findIndex(({ id }) => id === before);
    const placement = {
      above: others[at - 1]?.id ?? null,
      below: others[at]?.id ?? null,
    };
    // Dropped back onto its own place.
    if (placement.above === (previousOf(tasks.data, column, task)?.id ?? null)) return;
    placing.mutate({ task, placement });
  };

  return (
    <>
      {tasks.error && <Alert tone="danger" title={tasks.error.message} />}
      <div className="board">
        {COLUMNS.map((column) => {
          const cards = tasks.data?.filter((task) => column.states.includes(task.state)) ?? [];
          return (
            <section key={column.key} className="board-column" aria-label={column.label}>
              <h3>
                {column.label} <span className="board-count">{cards.length}</span>
              </h3>
              <div className="board-hint">{column.hint(planner)}</div>
              <div
                className="board-cards"
                onDragOver={(event) => {
                  if (!dragged) return;
                  event.preventDefault();
                  const before = cardUnder(event);
                  setTarget(before === undefined ? { endOf: column.key } : { before });
                }}
                onDrop={(event) => drop(column, event)}
              >
                {cards.map((task) => (
                  <BoardCard
                    key={task.id}
                    task={task}
                    projects={projects.data}
                    dragging={dragged?.id === task.id}
                    dropBefore={
                      target !== undefined && "before" in target && target.before === task.id
                    }
                    onDragStart={() => setDragged(task)}
                    onDragEnd={() => {
                      setDragged(undefined);
                      setTarget(undefined);
                    }}
                  />
                ))}
                {cards.length === 0 && <div className="board-empty">Nothing here</div>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="board-note">
        <Icon name="grip-vertical" size={13} />
        Drag a card that has not started to reorder it within its column; dropping it among another
        priority takes that priority.
      </p>
    </>
  );
}

function BoardCard({
  task,
  projects,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
}: {
  readonly task: Task;
  readonly projects: readonly Project[] | undefined;
  readonly dragging: boolean;
  readonly dropBefore: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
}): ReactNode {
  const project = projects?.find(({ id }) => id === task.projectId);
  const movable = NOT_STARTED.includes(task.state);
  const classes = [
    "board-card",
    EDGES[task.state],
    dragging && "dragging",
    dropBefore && "drop-before",
  ].filter(Boolean);
  return (
    <article
      className={classes.join(" ")}
      aria-label={task.title}
      data-task-id={task.id}
      draggable={movable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="board-card-head">
        <PriorityIcon priority={task.priority} />
        <Link
          to="/tasks/$taskId"
          params={{ taskId: task.id }}
          className="board-card-title"
          draggable={false}
        >
          {task.title}
        </Link>
        <TaskMenu task={task} />
      </div>
      <div className="board-card-meta">
        {project ? <ProjectMark project={project} /> : task.projectId}
      </div>
      {!movable && task.state !== "in-progress" && task.state !== "done" && (
        <div className="board-card-foot">
          <TaskStateBadge state={task.state} />
        </div>
      )}
    </article>
  );
}

/** Moves the card where it was dropped at once, and lets the service settle its priority. */
function usePlacing() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const listKey = taskQueries.list().queryKey;
  return useMutation({
    mutationFn: ({ task, placement }: { task: Task; placement: TaskPlacement }) =>
      placeTask(task.id, placement),
    onMutate: async ({ task, placement }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const before = queryClient.getQueryData(listKey);
      queryClient.setQueryData(listKey, (list) => list && moved(list, task, placement));
      return { before };
    },
    onSuccess: (placed, { task }) => {
      if (placed.priority !== task.priority) {
        showToast(
          `${placed.title} is now ${PRIORITY_NAMES[placed.priority].toLowerCase()} priority.`,
        );
      }
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(listKey, context?.before);
      showToast(error.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
  });
}

/** The list with `task` taken out and put back just before `below`, or just after `above`. */
function moved(list: readonly Task[], task: Task, { above, below }: TaskPlacement): Task[] {
  const others = list.filter(({ id }) => id !== task.id);
  const at =
    below !== null
      ? others.findIndex(({ id }) => id === below)
      : others.findIndex(({ id }) => id === above) + 1;
  return [...others.slice(0, at), task, ...others.slice(at)];
}

/** The card in the column just above `task`, which a drop right back onto its place names. */
function previousOf(list: readonly Task[], column: Column, task: Task): Task | undefined {
  const cards = list.filter(({ state }) => column.states.includes(state));
  const index = cards.findIndex(({ id }) => id === task.id);
  return index > 0 ? cards[index - 1] : undefined;
}

/** The id of the card the pointer is over, if any. */
function cardUnder(event: DragEvent): string | undefined {
  const card = (event.target as Element).closest<HTMLElement>("[data-task-id]");
  return card?.dataset["taskId"];
}
