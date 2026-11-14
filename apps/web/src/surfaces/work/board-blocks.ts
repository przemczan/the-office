import type { QueuedTask, Task } from "@the-office/contracts";
import { queuedEntryOf, type Column } from "./board-columns.ts";
import { groupKeyOf, NO_INITIATIVE } from "./board-groups.ts";

/** A column's item: an Initiative's block with its cards, or a card with no Initiative. */
export type ColumnItem =
  | {
      readonly kind: "block";
      readonly initiativeId: string;
      readonly cards: readonly Task[];
    }
  | { readonly kind: "loose"; readonly card: Task };

export const BLOCK_REFUSAL =
  "A card moves only within its own block: the board doesn't change a Task's Initiative.";
export const LOOSE_REFUSAL =
  "A card with no Initiative moves only among the cards outside the blocks: the board doesn't change a Task's Initiative.";

/**
 * A column's cards, in the order they show (`cardsIn`), gathered by Initiative: each Initiative's
 * cards make one block, placed where its first card falls, its cards in the column's order; a card
 * with no Initiative stays loose in its place. `blockOf` names a card's block, `NO_INITIATIVE` for
 * none.
 */
export function columnBlocks(
  cards: readonly Task[],
  blockOf: (card: Task) => string = groupKeyOf,
): ColumnItem[] {
  const items: ColumnItem[] = [];
  const blocks = new Map<string, Task[]>();
  for (const card of cards) {
    const initiativeId = blockOf(card);
    if (initiativeId === NO_INITIATIVE) {
      items.push({ kind: "loose", card });
      continue;
    }
    const gathered = blocks.get(initiativeId);
    if (gathered) {
      gathered.push(card);
      continue;
    }
    const blockCards = [card];
    blocks.set(initiativeId, blockCards);
    items.push({ kind: "block", initiativeId, cards: blockCards });
  }
  return items;
}

/** The cards a card dropped in the block `key` lands among: its cards, or the loose ones. */
export function cardsOfBlock(items: readonly ColumnItem[], key: string): Task[] {
  return items.flatMap((item) => {
    if (item.kind === "loose") return key === NO_INITIATIVE ? [item.card] : [];
    return item.initiativeId === key ? item.cards : [];
  });
}

/** Why a card of the block `from` can't be dropped in the block `over`; undefined when it can. */
export function blockDropRefusal(from: string, over: string): string | undefined {
  if (from === over) return undefined;
  return from === NO_INITIATIVE ? LOOSE_REFUSAL : BLOCK_REFUSAL;
}

/** A block head's count: how many cards the column shows, or in Queued their places, with its words. */
export function blockCount(
  cards: readonly Task[],
  column: Column,
  queue: readonly QueuedTask[],
): { readonly shown: string; readonly words: string } {
  if (column.key === "queued") {
    const places = cards.flatMap((card) => queuedEntryOf(card, queue)?.place ?? []);
    return {
      shown: places.map((place) => `#${place}`).join(" · "),
      words: `${places.length === 1 ? "Place" : "Places"} ${new Intl.ListFormat("en").format(places.map(String))} in the queue`,
    };
  }
  return { shown: String(cards.length), words: `${cards.length} of its Tasks in ${column.label}` };
}
