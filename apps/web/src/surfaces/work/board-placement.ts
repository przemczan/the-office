import type { TaskPlacement, TaskSummary } from "@the-office/contracts";

/**
 * Where a card dropped just before `beforeId`, or at the column's end, lands; undefined when it
 * stays where it is. `cards` are the column's cards on show: the neighbours are the ones the user
 * dropped between, never a Task the filters hide, which may have moved on since this list was read.
 */
export function placementAmong(
  cards: readonly TaskSummary[],
  task: TaskSummary,
  beforeId: string | undefined,
): TaskPlacement | undefined {
  if (beforeId === task.id) return undefined;
  const others = cards.filter(({ id }) => id !== task.id);
  const at = beforeId === undefined ? others.length : others.findIndex(({ id }) => id === beforeId);
  if (at < 0) return undefined;
  const above = others[at - 1]?.id ?? null;
  const previous = cards[cards.findIndex(({ id }) => id === task.id) - 1]?.id ?? null;
  return above === previous ? undefined : { above, below: others[at]?.id ?? null };
}
