import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, QueuedTask, Task, TaskPlacement, TaskState } from "@the-office/contracts";
import { Alert, Icon } from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import { Fragment, useRef, useState, type DragEvent, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, placeTask, taskQueries } from "../../api/work.ts";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { PriorityIcon, TaskStateBadge } from "../../shell/work/task-state-badge.tsx";
import { UsageEstimateLine, useUsageEstimate } from "../../shell/work/usage-estimate-line.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { useWaitingOnYouInItsState } from "../../shell/work/waiting-on-you.ts";
import { NOT_STARTED, PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { cardsIn, COLUMNS, queuedEntryOf, type Column } from "./board-columns.ts";
import { isOnBoard } from "./board-filters.ts";
import { placementAmong } from "./board-placement.ts";
import { blockingTasksOf } from "./dependency-words.ts";
import { FilterBar } from "./filter-bar.tsx";
import { MakeAPlanButton } from "./planning-actions.tsx";
import { QueuedMark } from "./queue-parts.tsx";
import { TaskMenu } from "./task-menu.tsx";
import { useBoardFilters } from "./use-board-filters.ts";
import { usePeopleWorking, WorkingMark, type PersonWorking } from "./working-mark.tsx";

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
 * The Tasks of the Projects the Project filter shows, by column (`board-columns.ts`).
 * A card that hasn't started drags within its column; dropped among another priority, it takes it.
 * A queued card doesn't drag: its order is the queue's.
 */
export function Board(): ReactNode {
  const tasks = useQuery(taskQueries.list());
  const queue = useQuery(taskQueries.queue()).data ?? [];
  const projects = useQuery(projectQueries.list());
  const initiatives = useQuery(initiativeQueries.list());
  const { filters, change: changeFilters, shows } = useBoardFilters(tasks.data ?? []);
  const projectFilter = useProjectFilter();
  // Blockers and placement read every Task: one in another Project still holds a Task back.
  const inProjectFilter = (task: Task): boolean => projectFilter.shows([task.projectId]);
  const onBoard = tasks.data?.filter(isOnBoard) ?? [];
  const matching = onBoard.filter(shows);
  const [dragged, setDragged] = useState<Task>();
  const [target, setTarget] = useState<DropTarget>();
  const placing = usePlacing();
  const showToast = useToast();
  const waitingOnYou = useWaitingOnYouInItsState();
  const planner = usePlanner()?.card.name;
  const peopleWorkingOn = usePeopleWorking();

  const cardsOf = (column: Column): Task[] =>
    cardsIn(column, matching.filter(inProjectFilter), queue);

  const drop = (column: Column, event: DragEvent): void => {
    event.preventDefault();
    const task = dragged;
    setDragged(undefined);
    setTarget(undefined);
    if (!task || !tasks.data) return;
    if (!column.holds(task, queue)) {
      showToast("A Task changes state through its actions: Plan, Mark Ready, Start.");
      return;
    }
    const placement = placementAmong(cardsOf(column), task, cardUnder(event));
    if (placement) placing.mutate({ task, placement });
  };

  return (
    <>
      <FilterBar
        filters={filters}
        initiatives={
          initiatives.data?.filter(
            ({ id, projectIds }) => projectFilter.shows(projectIds) || id === filters.initiative,
          ) ?? []
        }
        onChange={changeFilters}
      />
      <InOtherProjectsNote
        count={matching.filter((task) => !inProjectFilter(task)).length}
        one="Task"
        many="Tasks"
      />
      {tasks.error && <Alert tone="danger" title={tasks.error.message} />}
      <div className="board">
        {COLUMNS.map((column) => {
          const cards = cardsOf(column);
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
                    queued={queuedEntryOf(task, queue)}
                    blockers={blockingTasksOf(task, tasks.data ?? [])}
                    peopleWorking={peopleWorkingOn(task.id)}
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
        priority takes that priority. Queued cards keep their place in the queue.
      </p>
    </>
  );
}

function BoardCard({
  task,
  projects,
  planner,
  waiting,
  queued,
  blockers,
  peopleWorking,
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
  /** Its place in the queue for Start; undefined while it isn't queued. */
  readonly queued: QueuedTask | undefined;
  /** The Tasks still holding it back. */
  readonly blockers: readonly Task[];
  /** The names of the people working on it now. */
  readonly peopleWorking: readonly PersonWorking[];
  readonly dragging: boolean;
  readonly dropBefore: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
}): ReactNode {
  const project = projects?.find(({ id }) => id === task.projectId);
  const movable = NOT_STARTED.includes(task.state) && !queued;
  const foot = queued ? <QueuedMark queued={queued} /> : footOf(task, planner, waiting);
  // Only Ready Tasks, queued ones too, have one.
  const usageEstimate = useUsageEstimate(task.id);
  const titleLink = useRef<HTMLAnchorElement>(null);
  const someoneWorking = peopleWorking.length > 0;
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
          ref={titleLink}
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
      {(foot || usageEstimate || someoneWorking) && (
        <div className="board-card-foot">
          {foot}
          <UsageEstimateLine estimate={usageEstimate} />
          {someoneWorking && (
            // Above the title's stretched link for its tooltip, so a press is passed on to the link.
            <span className="board-card-working" onClick={() => titleLink.current?.click()}>
              <WorkingMark people={peopleWorking} />
            </span>
          )}
        </div>
      )}
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
 * What a card says below its title: Plan in Backlog (Make a plan, so the board stays open while
 * the Planner plans), how planning stands, or a state the column doesn't name already; undefined
 * when there is nothing to say.
 */
function footOf(task: Task, planner: string | undefined, waiting: boolean): ReactNode {
  switch (task.state) {
    case "backlog":
      return planner && <MakeAPlanButton task={task} label="Plan" variant="secondary" size="sm" />;
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
          <TaskStateBadge state="paused" pausedByAlarm={task.pausedByAlarm} />
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

/** The id of the card the pointer is over, if any. */
function cardUnder(event: DragEvent): string | undefined {
  const card = (event.target as Element).closest<HTMLElement>("[data-task-id]");
  return card?.dataset["taskId"];
}
