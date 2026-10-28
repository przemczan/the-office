import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, Task, TaskPlacement, TaskState } from "@the-office/contracts";
import { Alert, Icon } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import { Fragment, useState, type DragEvent, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { placeTask, taskQueries } from "../../api/work.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { PriorityIcon, TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { useWaitingOnYouInItsState } from "../../shell/work/waiting-on-you.ts";
import { NOT_STARTED, PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { blockingTasksOf } from "./dependency-words.ts";
import { PlanButton } from "./planning-actions.tsx";
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
  const [dragged, setDragged] = useState<Task>();
  const [target, setTarget] = useState<DropTarget>();
  const placing = usePlacing();
  const showToast = useToast();
  const waitingOnYou = useWaitingOnYouInItsState();
  const planner = usePlanner()?.card.name;

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
              <div className="board-hint">{column.hint(planner ?? "the Planner")}</div>
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
                    planner={planner}
                    waiting={waitingOnYou(task)}
                    blockers={blockingTasksOf(task, tasks.data ?? [])}
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
  planner,
  waiting,
  blockers,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
}: {
  readonly task: Task;
  readonly projects: readonly Project[] | undefined;
  /** The Planner's name; undefined while nobody is the Planner. */
  readonly planner: string | undefined;
  /** In Planning or Paused with a Decision open. */
  readonly waiting: boolean;
  /** The Tasks still holding it back. */
  readonly blockers: readonly Task[];
  readonly dragging: boolean;
  readonly dropBefore: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
}): ReactNode {
  const project = projects?.find(({ id }) => id === task.projectId);
  const movable = NOT_STARTED.includes(task.state);
  const foot = footOf(task, planner, waiting);
  const classes = [
    "board-card",
    waiting ? "edge-decision" : EDGES[task.state],
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
        {task.tags.map((tag) => (
          <span key={tag} className="board-card-tag">
            {tag}
          </span>
        ))}
      </div>
      {blockers.length > 0 && <BlockedMark blockers={blockers} />}
      {foot && <div className="board-card-foot">{foot}</div>}
    </article>
  );
}

/** "Blocked by" and the Tasks that must be Done first, each a link to its page. */
function BlockedMark({ blockers }: { readonly blockers: readonly Task[] }): ReactNode {
  return (
    <div className="board-card-blocked">
      <Icon name="lock" size={12} />
      <span>
        Blocked by{" "}
        {blockers.map((blocker, index) => (
          <Fragment key={blocker.id}>
            {index > 0 && ", "}
            <Link to="/tasks/$taskId" params={{ taskId: blocker.id }} draggable={false}>
              {blocker.title}
            </Link>
          </Fragment>
        ))}
      </span>
    </div>
  );
}

/**
 * What a card says below its title: Plan in Backlog, how planning stands, or a state the column
 * doesn't name already; undefined when there is nothing to say.
 */
function footOf(task: Task, planner: string | undefined, waiting: boolean): ReactNode {
  switch (task.state) {
    case "backlog":
      return planner && <PlanButton task={task} label="Plan" size="sm" />;
    case "planning":
      return waiting ? (
        <TaskStateBadge state="waiting-on-you" />
      ) : (
        <span className="board-card-note">Planning with {planner ?? "the Planner"}</span>
      );
    case "ready":
    case "in-progress":
    case "done":
      return undefined;
    // Held with a Decision its Agent opened before: Paused and Waiting on you at once (spec §2.4).
    case "paused":
      return (
        <>
          <TaskStateBadge state="paused" />
          {waiting && <TaskStateBadge state="waiting-on-you" />}
        </>
      );
    default:
      return <TaskStateBadge state={task.state} />;
  }
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
