import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Task, TaskPlacement } from "@the-office/contracts";
import { Alert, Icon } from "@the-office/ui";
import { useState, type DragEvent, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, placeTask, taskQueries } from "../../api/work.ts";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useCto } from "../../shell/work/use-cto.ts";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { useWaitingOnYouInItsState } from "../../shell/work/waiting-on-you.ts";
import { PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { BoardCard } from "./board-card.tsx";
import { cardsIn, COLUMNS, queuedEntryOf, type Column } from "./board-columns.ts";
import { isOnBoard } from "./board-filters.ts";
import { GroupedBoard } from "./board-group.tsx";
import { useBoardGroupFolds } from "./board-group-folds.ts";
import { boardGroups, groupKeyOf, type BoardGroup } from "./board-groups.ts";
import { placementAmong } from "./board-placement.ts";
import { blockingTasksOf } from "./dependency-words.ts";
import { FilterBar } from "./filter-bar.tsx";
import { useBoardFilters, useBoardGrouping } from "./use-board-filters.ts";
import { stageWorkedNow, useCurrentStage, usePeopleWorking } from "./working-mark.tsx";

/** Where a dragged card would land: before a card, or at the end of its list. */
type DropTarget = { readonly before: string } | { readonly endOf: string };

const STATE_REFUSAL = "A Task changes state through its actions: Plan, Mark Ready, Start.";
const GROUP_REFUSAL =
  "A card moves only within its own group: the board doesn't change a Task's Initiative.";

/**
 * The Tasks of the Projects the Project filter shows, by column (`board-columns.ts`), grouped by
 * Initiative while the switch says so (`board-groups.ts`). A card that hasn't started drags within
 * its column, inside its own group; dropped among another priority, it takes it. A queued card
 * doesn't drag: its order is the queue's.
 */
export function Board(): ReactNode {
  const tasks = useQuery(taskQueries.list());
  const queue = useQuery(taskQueries.queue()).data ?? [];
  const projects = useQuery(projectQueries.list());
  const initiatives = useQuery(initiativeQueries.list());
  const { filters, change: changeFilters, shows } = useBoardFilters(tasks.data ?? []);
  const grouping = useBoardGrouping();
  const folds = useBoardGroupFolds();
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
  const cto = useCto();
  const peopleWorkingOn = usePeopleWorking();
  const currentStageOf = useCurrentStage();

  const groups =
    grouping.grouped && tasks.data && initiatives.data
      ? boardGroups({
          tasks: tasks.data,
          initiatives: initiatives.data,
          inProjectFilter,
          matches: shows,
          chosenInitiative: filters.initiative,
        })
      : undefined;
  const foldable = groups?.kind === "all" && groups.groups.length > 1 ? groups.groups : undefined;

  const endDrag = (): void => {
    setDragged(undefined);
    setTarget(undefined);
  };

  /** Drops the dragged card among `cards`, the column's in its group when grouped. */
  const drop = (
    column: Column,
    cards: readonly Task[],
    group: BoardGroup | undefined,
    event: DragEvent,
  ): void => {
    event.preventDefault();
    const task = dragged;
    endDrag();
    if (!task) return;
    if (group && groupKeyOf(task) !== group.key) {
      showToast(GROUP_REFUSAL);
      return;
    }
    if (!column.holds(task, queue)) {
      showToast(STATE_REFUSAL);
      return;
    }
    const placement = placementAmong(cards, task, cardUnder(event));
    if (placement) placing.mutate({ task, placement });
  };

  const cardOf = (task: Task): ReactNode => {
    const peopleWorking = peopleWorkingOn(task.id);
    const queued = queuedEntryOf(task, queue);
    return (
      <BoardCard
        key={task.id}
        task={task}
        projects={projects.data}
        planner={planner}
        waiting={waitingOnYou(task)}
        queued={queued}
        queuedBehind={tasksAmong(queued?.behind ?? [], tasks.data ?? [])}
        blockers={blockingTasksOf(task, tasks.data ?? [])}
        peopleWorking={peopleWorking}
        stageName={stageWorkedNow(peopleWorking, currentStageOf(task.id))}
        dragging={dragged?.id === task.id}
        dropBefore={target !== undefined && "before" in target && target.before === task.id}
        onDragStart={() => setDragged(task)}
        onDragEnd={endDrag}
      />
    );
  };

  /** A column's cards, where a dragged card is dropped; `marks` says whether it shows where it lands. */
  const cardsArea = ({
    cards,
    listKey,
    marks,
    onDrop,
    emptyNote,
  }: {
    readonly cards: readonly Task[];
    readonly listKey: string;
    readonly marks: boolean;
    readonly onDrop: (event: DragEvent) => void;
    readonly emptyNote: boolean;
  }): ReactNode => (
    <div
      className="board-cards"
      onDragOver={(event) => {
        if (!dragged) return;
        event.preventDefault();
        const before = cardUnder(event);
        if (!marks) setTarget(undefined);
        else setTarget(before === undefined ? { endOf: listKey } : { before });
      }}
      onDrop={onDrop}
    >
      {cards.map(cardOf)}
      {emptyNote && cards.length === 0 && <div className="board-empty">Nothing here</div>}
    </div>
  );

  const canLandIn = (group: BoardGroup, column: Column): boolean =>
    dragged !== undefined && groupKeyOf(dragged) === group.key && column.holds(dragged, queue);

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
        grouped={grouping.grouped}
        onGroupedChange={grouping.change}
        folding={
          foldable && {
            allFolded: foldable.every((group) => !folds.isOpen(group)),
            onFoldAll: (open) => folds.setAll(foldable, open),
          }
        }
      />
      <InOtherProjectsNote
        count={matching.filter((task) => !inProjectFilter(task)).length}
        one="Task"
        many="Tasks"
      />
      {tasks.error && <Alert tone="danger" title={tasks.error.message} />}
      {initiatives.error && grouping.grouped && (
        <Alert tone="danger" title={initiatives.error.message} />
      )}
      {!grouping.grouped ? (
        <BoardColumns
          planner={planner}
          cardsOf={(column) => cardsIn(column, matching.filter(inProjectFilter), queue)}
          cardsArea={(column, cards) =>
            cardsArea({
              cards,
              listKey: column.key,
              marks: true,
              onDrop: (event) => drop(column, cards, undefined, event),
              emptyNote: true,
            })
          }
        />
      ) : (
        groups && (
          <GroupedBoard
            grouping={groups}
            tasks={tasks.data ?? []}
            queue={queue}
            projects={projects.data}
            cto={cto}
            planner={planner ?? "the Planner"}
            folds={folds}
            canLandIn={canLandIn}
            cardsArea={(group, column, cards) =>
              cardsArea({
                cards,
                listKey: `${group.key}:${column.key}`,
                marks: canLandIn(group, column),
                onDrop: (event) => drop(column, cards, group, event),
                emptyNote: false,
              })
            }
          />
        )
      )}
      <p className="board-note">
        <Icon name="grip-vertical" size={13} />
        {grouping.grouped
          ? "Drag a card that has not started to reorder it within its column, inside its own group; dropping it among another priority takes that priority. Queued cards keep their place in the queue."
          : "Drag a card that has not started to reorder it within its column; dropping it among another priority takes that priority. Queued cards keep their place in the queue."}
      </p>
    </>
  );
}

/** The six columns in a row, each with its head and its cards. */
function BoardColumns({
  planner,
  cardsOf,
  cardsArea,
}: {
  readonly planner: string | undefined;
  readonly cardsOf: (column: Column) => readonly Task[];
  readonly cardsArea: (column: Column, cards: readonly Task[]) => ReactNode;
}): ReactNode {
  return (
    <div className="board">
      {COLUMNS.map((column) => {
        const cards = cardsOf(column);
        return (
          <section key={column.key} className="board-column" aria-label={column.label}>
            <h3>
              {column.label} <span className="board-count">{cards.length}</span>
            </h3>
            <div className="board-hint">{column.hint(planner ?? "the Planner")}</div>
            {cardsArea(column, cards)}
          </section>
        );
      })}
    </div>
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

/** The Tasks of `ids` that are in `tasks`, in the order of `ids`. */
function tasksAmong(ids: readonly string[], tasks: readonly Task[]): Task[] {
  return ids.flatMap((id) => tasks.filter((task) => task.id === id));
}

/** The id of the card the pointer is over, if any. */
function cardUnder(event: DragEvent): string | undefined {
  const card = (event.target as Element).closest<HTMLElement>("[data-task-id]");
  return card?.dataset["taskId"];
}
