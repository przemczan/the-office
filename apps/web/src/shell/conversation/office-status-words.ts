import type { NeedsYouItem, RunningTask } from "@the-office/contracts";

/** "Waiting on you: 1 Decision, 2 Gates", or "Nothing waits on you." */
export function waitingWords(needsYou: readonly NeedsYouItem[]): string {
  const counts = [
    counted(needsYou.filter(({ kind }) => kind === "decision").length, "Decision"),
    counted(needsYou.filter(({ kind }) => kind === "gate").length, "Gate"),
  ].filter((count) => count !== undefined);
  return counts.length === 0 ? "Nothing waits on you." : `Waiting on you: ${counts.join(", ")}`;
}

/** "Paused: 2 Tasks"; undefined when no started Task is paused. */
export function pausedWords(running: readonly RunningTask[]): string | undefined {
  return counted(running.filter(({ state }) => state === "paused").length, "Task", "Paused: ");
}

function counted(count: number, noun: string, lead = ""): string | undefined {
  if (count === 0) return undefined;
  return `${lead}${count} ${noun}${count === 1 ? "" : "s"}`;
}
