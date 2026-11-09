import type { Initiative, QueuedTask, Task } from "@the-office/contracts";
import { cardsIn, COLUMNS, type Column } from "./board-columns.ts";
import { isOnBoard } from "./board-filters.ts";
import {
  initiativeProgress,
  tasksOfInitiative,
  type InitiativeProgress,
} from "./initiative-words.ts";

/** The key of the group of Tasks that aren't part of an Initiative. */
export const NO_INITIATIVE = "none";

/** The board's cards of one Initiative, or of none, when grouped by Initiative. */
export interface BoardGroup {
  /** The Initiative's id, or `none`: what its fold is remembered by. */
  readonly key: string;
  /** Undefined for No Initiative. */
  readonly initiative: Initiative | undefined;
  /** Its cards on the board, in every Project. */
  readonly onBoard: readonly Task[];
  /** Those in the Projects the Project filter shows. */
  readonly inProjects: readonly Task[];
  /** Those the filters leave too: the cards it shows. */
  readonly shown: readonly Task[];
}

/** Why the group the Initiative filter picked has no card to show. */
export type EmptyGroupReason = "being-shaped" | "all-archived" | "other-projects" | "no-match";

export type BoardGroups =
  /** The Initiative filter is set: its group alone, always open. */
  | {
      readonly kind: "alone";
      readonly group: BoardGroup;
      /** Undefined while it has a card to show. */
      readonly emptyBecause: EmptyGroupReason | undefined;
    }
  | {
      readonly kind: "all";
      /** Each group with a card to show, in the board's order. */
      readonly groups: readonly BoardGroup[];
      /**
       * Those with cards in the Projects shown that search, Priority or Blocked left with none,
       * named under the groups; none when no group is left, as `nothingMatches` says it.
       */
      readonly leftOut: readonly BoardGroup[];
      /** The board has cards, but the filters leave none: one block says so. */
      readonly nothingMatches: boolean;
    };

export interface BoardGroupsInput {
  /** Every Task, archived and in Shaping too. */
  readonly tasks: readonly Task[];
  /** As `GET /initiatives` answers: the newest first. */
  readonly initiatives: readonly Initiative[];
  readonly inProjectFilter: (task: Task) => boolean;
  /** Whether a Task shows under the board's filters. */
  readonly matches: (task: Task) => boolean;
  /** The Initiative filter's pick. */
  readonly chosenInitiative: string | undefined;
}

export function groupKeyOf(task: Pick<Task, "initiativeId">): string {
  return task.initiativeId ?? NO_INITIATIVE;
}

/** An Initiative that ended (Done or Dropped) has nothing waiting on anyone. */
export function hasEnded(initiative: Pick<Initiative, "state">): boolean {
  return initiative.state === "done" || initiative.state === "dropped";
}

/**
 * The board's groups: one for each Initiative with a card on the board, newest first with the Active
 * ones before those that ended, then No Initiative. A shaping Initiative's Tasks are off the board,
 * so it has none. The Initiative filter gives its group alone, with why it is empty when it is.
 */
export function boardGroups({
  tasks,
  initiatives,
  inProjectFilter,
  matches,
  chosenInitiative,
}: BoardGroupsInput): BoardGroups {
  const cards = tasks.filter(isOnBoard);
  const groupOf = (key: string, initiative: Initiative | undefined): BoardGroup => {
    const onBoard = cards.filter((task) => groupKeyOf(task) === key);
    const inProjects = onBoard.filter(inProjectFilter);
    return { key, initiative, onBoard, inProjects, shown: inProjects.filter(matches) };
  };

  const chosen = initiatives.find(({ id }) => id === chosenInitiative);
  if (chosen) {
    const group = groupOf(chosen.id, chosen);
    return { kind: "alone", group, emptyBecause: whyEmpty(group, chosen) };
  }

  const byInitiative = initiatives
    .filter(({ state }) => state !== "shaping")
    .toSorted((first, second) => Number(hasEnded(first)) - Number(hasEnded(second)))
    .map((initiative) => groupOf(initiative.id, initiative));
  const onTheBoard = [...byInitiative, groupOf(NO_INITIATIVE, undefined)].filter(
    ({ onBoard }) => onBoard.length > 0,
  );
  const groups = onTheBoard.filter(({ shown }) => shown.length > 0);
  const nothingMatches = groups.length === 0 && onTheBoard.length > 0;
  return {
    kind: "all",
    groups,
    leftOut:
      groups.length === 0
        ? []
        : onTheBoard.filter(({ inProjects, shown }) => inProjects.length > 0 && shown.length === 0),
    nothingMatches,
  };
}

function whyEmpty(group: BoardGroup, initiative: Initiative): EmptyGroupReason | undefined {
  if (group.shown.length > 0) return undefined;
  if (group.onBoard.length === 0) {
    return initiative.state === "shaping" ? "being-shaped" : "all-archived";
  }
  return group.inProjects.length === 0 ? "other-projects" : "no-match";
}

const EMPTY_GROUP_WORDS: Readonly<Record<EmptyGroupReason, string>> = {
  "being-shaped": "Its Tasks join the board once the Initiative is confirmed.",
  "all-archived": "None of its Tasks is on the board.",
  "other-projects": "Its Tasks on the board are in Projects the Project filter hides.",
  "no-match": "None of its Tasks on the board matches the filters.",
};

export function emptyGroupWords(reason: EmptyGroupReason): string {
  return EMPTY_GROUP_WORDS[reason];
}

export function groupName(group: BoardGroup): string {
  return group.initiative?.name ?? "No Initiative";
}

/** The header's progress, over every Task of the Initiative, archived and in Shaping too. */
export function groupProgress(initiative: Initiative, tasks: readonly Task[]): InitiativeProgress {
  return initiativeProgress(tasksOfInitiative(initiative, tasks), tasks);
}

/** The header's count: "4 on the board", or "3 of 7 shown" while a filter hides some. */
export function groupCountWords({ onBoard, shown }: BoardGroup): string {
  return shown.length === onBoard.length
    ? `${onBoard.length} on the board`
    : `${shown.length} of ${onBoard.length} shown`;
}

/** A folded group's line: "Backlog 1 · In progress 1 · Done 2", the empty columns left out. */
export function foldedGroupWords(group: BoardGroup, queue: readonly QueuedTask[]): string {
  return COLUMNS.map(
    (column) => [column.label, cardsIn(column, group.shown, queue).length] as const,
  )
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
}

/** A column head's count, over the cards shown in every group. */
export function columnCount(
  column: Column,
  groups: readonly BoardGroup[],
  queue: readonly QueuedTask[],
): number {
  return groups.reduce((sum, group) => sum + cardsIn(column, group.shown, queue).length, 0);
}

/** The line under the groups naming those search, Priority or Blocked left out. */
export function leftOutWords(leftOut: readonly BoardGroup[]): string {
  const names = leftOut.map(groupName).join(", ");
  const groupsAre = leftOut.length === 1 ? "its group is" : "their groups are";
  return `No Task matches the filters in ${names}, so ${groupsAre} left out.`;
}

export const NOTHING_MATCHES =
  "No Task on the board matches the filters. Clear them, or show all projects.";
