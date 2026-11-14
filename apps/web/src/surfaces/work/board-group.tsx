import { Link } from "@tanstack/react-router";
import type { Project, QueuedTask, Role, Task } from "@the-office/contracts";
import { FoldButton, Icon, ProgressBar } from "@the-office/ui";
import { useRef, type MouseEvent, type ReactNode } from "react";
import { cardsIn, COLUMNS, type Column } from "./board-columns.ts";
import type { BoardGroupFolds } from "./board-group-folds.ts";
import {
  columnCount,
  emptyGroupWords,
  foldedGroupWords,
  groupCountWords,
  groupName,
  groupProgress,
  leftOutWords,
  NOTHING_MATCHES,
  type BoardGroup,
  type BoardGroups,
  type EmptyGroupReason,
} from "./board-groups.ts";
import { InitiativeProjects, InitiativeStateBadge } from "./initiative-parts.tsx";
import { InitiativePausedBadge } from "./initiative-pause.tsx";
import { progressWords, type InitiativeProgress } from "./initiative-words.ts";

export interface GroupedBoardProps {
  readonly grouping: BoardGroups;
  /** Every Task, for each Initiative's progress. */
  readonly tasks: readonly Task[];
  readonly queue: readonly QueuedTask[];
  readonly projects: readonly Project[] | undefined;
  readonly shaper: Role | undefined;
  readonly planner: string;
  readonly folds: BoardGroupFolds;
  /** The column's cards in a group, where a card is dropped. */
  readonly cardsArea: (group: BoardGroup, column: Column, cards: readonly Task[]) => ReactNode;
  /** The one column of its group a dragged card can land in, outlined. */
  readonly canLandIn: (group: BoardGroup, column: Column) => boolean;
}

/**
 * The board grouped by Initiative: the column heads once, sticking to the top as the page scrolls,
 * then a group per Initiative and No Initiative. The groups scroll sideways together, the heads
 * following them, and each group's header stays in the visible part of the board.
 */
export function GroupedBoard(props: GroupedBoardProps): ReactNode {
  const { grouping, queue, planner } = props;
  const heads = useRef<HTMLDivElement>(null);
  const shown = grouping.kind === "alone" ? [grouping.group] : grouping.groups;
  return (
    <>
      <div className="board-heads-frame" ref={heads}>
        <div className="board-heads board-row">
          {COLUMNS.map((column) => (
            <div key={column.key} className="board-head" aria-label={column.label}>
              <h3>
                {column.label}{" "}
                <span className="board-count">{columnCount(column, shown, queue)}</span>
              </h3>
              <div className="board-hint">{column.hint(planner)}</div>
            </div>
          ))}
        </div>
      </div>
      <div
        className="board-groups"
        onScroll={(event) => {
          if (heads.current) heads.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        <div className="board-groups-track">
          {grouping.kind === "alone" ? (
            <GroupSection {...props} group={grouping.group} emptyBecause={grouping.emptyBecause} />
          ) : (
            grouping.groups.map((group) => (
              <GroupSection
                key={group.key}
                {...props}
                group={group}
                foldable
                emptyBecause={undefined}
              />
            ))
          )}
        </div>
      </div>
      {grouping.kind === "all" && grouping.nothingMatches && (
        <div className="board-nothing">{NOTHING_MATCHES}</div>
      )}
      {grouping.kind === "all" && grouping.leftOut.length > 0 && (
        <p className="groups-left-out-note">{leftOutWords(grouping.leftOut)}</p>
      )}
    </>
  );
}

function GroupSection({
  group,
  foldable = false,
  emptyBecause,
  tasks,
  queue,
  projects,
  shaper,
  folds,
  cardsArea,
  canLandIn,
}: GroupedBoardProps & {
  readonly group: BoardGroup;
  /** With the Initiative filter set, its group is always open and its name plain. */
  readonly foldable?: boolean;
  readonly emptyBecause: EmptyGroupReason | undefined;
}): ReactNode {
  const name = groupName(group);
  const open = !foldable || folds.isOpen(group);
  const nameWords = (
    <span className={group.initiative ? "group-name" : "group-name no-initiative"}>{name}</span>
  );
  const foldedWords = foldedGroupWords(group, queue);
  return (
    <section className={open ? "board-group" : "board-group folded"} aria-label={name}>
      <div
        className={
          foldable ? "group-head board-group-pinned foldable" : "group-head board-group-pinned"
        }
        onClick={
          foldable ? (event) => foldOnHeadClick(event, () => folds.toggle(group)) : undefined
        }
      >
        {foldable ? (
          <FoldButton unfolded={open} onClick={() => folds.toggle(group)}>
            {nameWords}
          </FoldButton>
        ) : (
          nameWords
        )}
        {group.initiative ? (
          <span className="group-sub">
            <InitiativeStateBadge initiative={group.initiative} shaper={shaper} />
            <InitiativePausedBadge initiative={group.initiative} />
            <span className="group-projects">
              <InitiativeProjects initiative={group.initiative} projects={projects} />
            </span>
            <GroupProgress progress={groupProgress(group.initiative, tasks)} />
          </span>
        ) : (
          <span className="group-sub">Tasks that aren't part of an Initiative</span>
        )}
        <span className="group-end">
          <span>{groupCountWords(group)}</span>
          {group.initiative && (
            <Link
              to="/work/initiatives/$initiativeId"
              params={{ initiativeId: group.initiative.id }}
              className="group-open"
              aria-label={`Open Initiative ${name}`}
            >
              <span className="group-open-words">Open Initiative</span>
              <Icon name="arrow-up-right" size={13} />
            </Link>
          )}
        </span>
      </div>
      {!open ? (
        foldedWords !== "" && (
          <div className="group-folded-counts board-group-pinned">{foldedWords}</div>
        )
      ) : emptyBecause ? (
        <div className="group-empty board-group-pinned">{emptyGroupWords(emptyBecause)}</div>
      ) : (
        <div className="board-row">
          {COLUMNS.map((column) => (
            <section
              key={column.key}
              className={canLandIn(group, column) ? "group-cell drop-ok" : "group-cell"}
              aria-label={`${column.label}, ${name}`}
            >
              {cardsArea(group, column, cardsIn(column, group.shown, queue))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * A press anywhere on a foldable head folds it, as a wider target for the pointer; the
 * `FoldButton` stays the one control for the keyboard and screen readers, so the head isn't a
 * second button. A press on a control inside the head, the `FoldButton` itself or "Open
 * Initiative", is that control's alone, and so is one in a popover, which React passes up the
 * head's tree though its DOM lies outside it.
 */
function foldOnHeadClick(event: MouseEvent<HTMLDivElement>, toggle: () => void): void {
  const { target, currentTarget } = event;
  if (!(target instanceof Element) || !currentTarget.contains(target)) return;
  const control = target.closest("a, button, input, [role='button']");
  if (control && currentTarget.contains(control)) return;
  toggle();
}

function GroupProgress({ progress }: { readonly progress: InitiativeProgress }): ReactNode {
  return (
    <span className="group-progress">
      <span className="group-progress-bar">
        <ProgressBar
          value={progress.done}
          max={Math.max(progress.counted, 1)}
          tone="success"
          size="sm"
          valueLabel=""
        />
      </span>
      {progressWords(progress)}
    </span>
  );
}
