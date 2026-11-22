import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskPlacement, TaskSummary } from "@the-office/contracts";
import { Alert, Icon } from "@the-office/ui";
import { useState, type DragEvent, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { initiativeQueries, placeTask, taskQueries, useEveryTask } from "../../api/work.ts";
import { ImportIssuesDialog } from "../../shell/issues/import-issues-dialog.tsx";
import { issueImportOf } from "../../shell/issues/issue-words.ts";
import { InOtherProjectsNote } from "../../shell/project-filter/in-other-projects-note.tsx";
import { useProjectFilter } from "../../shell/project-filter/use-project-filter.ts";
import { useToast } from "../../shell/toasts.tsx";
import { useShaper } from "../../shell/work/use-shaper.ts";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { useWaitingOnYouInItsState } from "../../shell/work/waiting-on-you.ts";
import { PRIORITY_NAMES } from "../../shell/work/work-words.ts";
import { InitiativeBlock } from "./board-block.tsx";
import { blockDropRefusal, cardsOfBlock, columnBlocks, type ColumnItem } from "./board-blocks.ts";
import { BoardCard } from "./board-card.tsx";
import { cardsIn, COLUMNS, queuedEntryOf, type Column } from "./board-columns.ts";
import { isOnBoard } from "./board-filters.ts";
import { GroupedBoard } from "./board-group.tsx";
import { useBoardGroupFolds } from "./board-group-folds.ts";
import { boardGroups, groupKeyOf, NO_INITIATIVE, type BoardGroup } from "./board-groups.ts";
import { placementAmong } from "./board-placement.ts";
import { blockingTasksOf } from "./dependency-words.ts";
import { FilterBar } from "./filter-bar.tsx";
import { useBoardFilters, useBoardGrouping } from "./use-board-filters.ts";
import { useCurrentStage, usePeopleWorking } from "./working-mark.tsx";

/** Where a dragged card would land: before a card, or at the end of its list. */
type DropTarget = { readonly before: string } | { readonly endOf: string };

const STATE_REFUSAL = "A Task changes state through its actions: Plan, Mark Ready, Start.";
const GROUP_REFUSAL =
  "A card moves only within its own group: the board doesn't change a Task's Initiative.";

/**
 * The Tasks of the Projects the Project filter shows, by column (`board-columns.ts`), grouped by
 * Initiative while the switch says so (`board-groups.ts`); otherwise each column gathers an
 * Initiative's cards into a block (`board-blocks.ts`), unless the Initiative filter is set. A card
 * that hasn't started drags within its column, inside its own group or block; dropped among another
 * priority, it takes it. A queued card doesn't drag: its order is the queue's.
 */
export function Board(): ReactNode {
  const tasks = useQuery(taskQueries.list());
  // An Initiative's progress counts its archived Tasks too.
  const everyTask = useEveryTask();
  const queue = useQuery(taskQueries.queue()).data ?? [];
  const projects = useQuery(projectQueries.list());
  const initiatives = useQuery(initiativeQueries.list());
  const { filters, change: changeFilters, shows } = useBoardFilters(tasks.data ?? []);
  const grouping = useBoardGrouping();
  const folds = useBoardGroupFolds();
  const projectFilter = useProjectFilter();
  // Blockers and placement read every Task: one in another Project still holds a Task back.
  const inProjectFilter = (task: TaskSummary): boolean => projectFilter.shows([task.projectId]);
  const onBoard = tasks.data?.filter(isOnBoard) ?? [];
  const matching = onBoard.filter(shows);
  const [dragged, setDragged] = useState<TaskSummary>();
  const [target, setTarget] = useState<DropTarget>();
  const [outlined, setOutlined] = useState<string>();
  const [importingIssues, setImportingIssues] = useState(false);
  const issueImport =
    projects.data && issueImportOf(projects.data, (id) => projectFilter.shows([id]));
  const placing = usePlacing();
  const showToast = useToast();
  const waitingOnYou = useWaitingOnYouInItsState();
  const planner = usePlanner()?.card.name;
  const shaper = useShaper();
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

  // Until the Initiatives are read, or while the Initiative filter is set, every card shows loose.
  const blockInitiatives = filters.initiative ? undefined : initiatives.data;
  const blockOf = (task: TaskSummary): string =>
    blockInitiatives?.some(({ id }) => id === task.initiativeId) ? groupKeyOf(task) : NO_INITIATIVE;

  const endDrag = (): void => {
    setDragged(undefined);
    setTarget(undefined);
  };

  /** Drops the dragged card among `cards`, the column's in its group. */
  const dropInGroup = (
    column: Column,
    cards: readonly TaskSummary[],
    group: BoardGroup,
    event: DragEvent,
  ): void => {
    event.preventDefault();
    const task = dragged;
    endDrag();
    if (!task) return;
    if (groupKeyOf(task) !== group.key) {
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

  /** Where the dragged card lands in a column's `items`: inside its own block, or among the loose cards. */
  const blockTarget = (column: Column, event: DragEvent): DropTarget | undefined => {
    const over = blockUnder(event);
    if (!dragged || blockDropRefusal(blockOf(dragged), over)) return undefined;
    return targetBefore(landingBefore(event, over), `${column.key}:${over}`);
  };

  /** Drops the dragged card in a column's `items`, refusing a drop outside its own block. */
  const dropInBlock = (column: Column, items: readonly ColumnItem[], event: DragEvent): void => {
    event.preventDefault();
    const task = dragged;
    endDrag();
    if (!task) return;
    if (!column.holds(task, queue)) {
      showToast(STATE_REFUSAL);
      return;
    }
    const over = blockUnder(event);
    const refusal = blockDropRefusal(blockOf(task), over);
    if (refusal) {
      showToast(refusal);
      return;
    }
    const placement = placementAmong(cardsOfBlock(items, over), task, landingBefore(event, over));
    if (placement) placing.mutate({ task, placement });
  };

  const cardOf = (task: TaskSummary): ReactNode => {
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
        stageName={currentStageOf(task.id)?.name}
        dragging={dragged?.id === task.id}
        dropBefore={target !== undefined && "before" in target && target.before === task.id}
        onDragStart={() => setDragged(task)}
        onDragEnd={endDrag}
      />
    );
  };

  /**
   * A column's cards, where a dragged card is dropped; `targetOf` says where it would land under the
   * pointer, undefined to mark nothing.
   */
  const cardsArea = ({
    children,
    isEmpty,
    targetOf,
    onDrop,
    emptyNote,
  }: {
    readonly children: ReactNode;
    readonly isEmpty: boolean;
    readonly targetOf: (event: DragEvent) => DropTarget | undefined;
    readonly onDrop: (event: DragEvent) => void;
    readonly emptyNote: boolean;
  }): ReactNode => (
    <div
      className="board-cards"
      onDragOver={(event) => {
        if (!dragged) return;
        event.preventDefault();
        setTarget(targetOf(event));
      }}
      onDrop={onDrop}
    >
      {children}
      {emptyNote && isEmpty && <div className="board-empty">Nothing here</div>}
    </div>
  );

  /** A column's items: a loose card as it is, a block as its head and its cards. */
  const itemsOf = (column: Column, items: readonly ColumnItem[]): ReactNode =>
    items.map((item) => {
      if (item.kind === "loose") return cardOf(item.card);
      const initiative = blockInitiatives?.find(({ id }) => id === item.initiativeId);
      if (!initiative) return item.cards.map(cardOf);
      return (
        <InitiativeBlock
          key={item.initiativeId}
          initiative={initiative}
          column={column}
          cards={item.cards}
          queue={queue}
          outlined={outlined === item.initiativeId}
          landing={
            dragged !== undefined &&
            blockOf(dragged) === item.initiativeId &&
            column.holds(dragged, queue)
          }
          onOutline={(initiativeId) => {
            if (!dragged) setOutlined(initiativeId);
          }}
          renderCard={cardOf}
        />
      );
    });

  /** While a card is dragged, its column steps back around its block, or its blocks around it. */
  const draggingIn = (column: Column): "block" | "loose" | undefined => {
    if (!dragged || !blockInitiatives || !column.holds(dragged, queue)) return undefined;
    return blockOf(dragged) === NO_INITIATIVE ? "loose" : "block";
  };

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
        onImportIssues={issueImport && (() => setImportingIssues(true))}
      />
      {importingIssues && issueImport && (
        <ImportIssuesDialog
          projects={issueImport.projects}
          projectId={issueImport.projectId}
          onClose={() => setImportingIssues(false)}
        />
      )}
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
          draggingIn={draggingIn}
          cardsArea={(column, cards) => {
            const items = columnBlocks(cards, blockOf);
            return cardsArea({
              children: itemsOf(column, items),
              isEmpty: cards.length === 0,
              targetOf: (event) => blockTarget(column, event),
              onDrop: (event) => dropInBlock(column, items, event),
              emptyNote: true,
            });
          }}
        />
      ) : (
        groups && (
          <GroupedBoard
            grouping={groups}
            tasks={everyTask.data ?? tasks.data ?? []}
            queue={queue}
            projects={projects.data}
            shaper={shaper}
            planner={planner ?? "whoever holds Plans"}
            folds={folds}
            canLandIn={canLandIn}
            cardsArea={(group, column, cards) =>
              cardsArea({
                children: cards.map(cardOf),
                isEmpty: cards.length === 0,
                targetOf: (event) =>
                  canLandIn(group, column)
                    ? targetBefore(cardUnder(event), `${group.key}:${column.key}`)
                    : undefined,
                onDrop: (event) => dropInGroup(column, cards, group, event),
                emptyNote: false,
              })
            }
          />
        )
      )}
      <p className="board-note">
        <Icon name="grip-vertical" size={13} />
        {boardNote(grouping.grouped, blockInitiatives !== undefined)}
      </p>
    </>
  );
}

/** The six columns in a row, each with its head and its cards. */
function BoardColumns({
  planner,
  cardsOf,
  draggingIn,
  cardsArea,
}: {
  readonly planner: string | undefined;
  readonly cardsOf: (column: Column) => readonly TaskSummary[];
  /** Whether a card of a block, or a loose card, is dragged in the column. */
  readonly draggingIn: (column: Column) => "block" | "loose" | undefined;
  readonly cardsArea: (column: Column, cards: readonly TaskSummary[]) => ReactNode;
}): ReactNode {
  return (
    <div className="board">
      {COLUMNS.map((column) => {
        const cards = cardsOf(column);
        const dragging = draggingIn(column);
        return (
          <section
            key={column.key}
            className={dragging ? `board-column dragging-${dragging}` : "board-column"}
            aria-label={column.label}
          >
            <h3>
              {column.label} <span className="board-count">{cards.length}</span>
            </h3>
            <div className="board-hint">{column.hint(planner ?? "whoever holds Plans")}</div>
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
    mutationFn: ({ task, placement }: { task: TaskSummary; placement: TaskPlacement }) =>
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
function moved(
  list: readonly TaskSummary[],
  task: TaskSummary,
  { above, below }: TaskPlacement,
): TaskSummary[] {
  const others = list.filter(({ id }) => id !== task.id);
  const at =
    below !== null
      ? others.findIndex(({ id }) => id === below)
      : others.findIndex(({ id }) => id === above) + 1;
  return [...others.slice(0, at), task, ...others.slice(at)];
}

/** The Tasks of `ids` that are in `tasks`, in the order of `ids`. */
function tasksAmong(ids: readonly string[], tasks: readonly TaskSummary[]): TaskSummary[] {
  return ids.flatMap((id) => tasks.filter((task) => task.id === id));
}

/** The id of the card the pointer is over, if any. */
function cardUnder(event: DragEvent): string | undefined {
  const card = (event.target as Element).closest<HTMLElement>("[data-task-id]");
  return card?.dataset["taskId"];
}

function targetBefore(before: string | undefined, listKey: string): DropTarget {
  return before === undefined ? { endOf: listKey } : { before };
}

/** The Initiative whose block the pointer is over, or `NO_INITIATIVE` among the loose cards. */
function blockUnder(event: DragEvent): string {
  const block = (event.target as Element).closest<HTMLElement>("[data-initiative-block]");
  return block?.dataset["initiativeBlock"] ?? NO_INITIATIVE;
}

/**
 * The card a drop lands before in the block `over`: the card under the pointer, or the first of the
 * block's cards below it, as a block's head and the gaps between its cards and between blocks hold
 * no card. The loose cards are the column's own, its `.board-cards`' children.
 */
function landingBefore(event: DragEvent, over: string): string | undefined {
  const under = cardUnder(event);
  if (under !== undefined) return under;
  const cards = event.currentTarget.querySelectorAll<HTMLElement>(
    over === NO_INITIATIVE
      ? ":scope > [data-task-id]"
      : `[data-initiative-block="${CSS.escape(over)}"] [data-task-id]`,
  );
  return [...cards].find((card) => card.getBoundingClientRect().top > event.clientY)?.dataset[
    "taskId"
  ];
}

function boardNote(grouped: boolean, withBlocks: boolean): string {
  if (grouped) {
    return "Drag a card that has not started to reorder it within its column, inside its own group; dropping it among another priority takes that priority. Queued cards keep their place in the queue.";
  }
  if (withBlocks) {
    return "Drag a card that has not started to reorder it within its column, inside its Initiative's block; dropping it among another priority takes that priority. Queued cards keep their place in the queue.";
  }
  return "Drag a card that has not started to reorder it within its column; dropping it among another priority takes that priority. Queued cards keep their place in the queue.";
}
