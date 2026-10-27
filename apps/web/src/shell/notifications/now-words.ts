import type { BadgeProps } from "@the-office/ui";
import type { CurrentStage, Now, TaskOutcome } from "@the-office/contracts";
import type { CardEdge } from "../item-card.tsx";
import { clockOf, durationWords, momentWords } from "../time.ts";

export const OUTCOME_NAMES: Readonly<Record<TaskOutcome, string>> = {
  done: "Done",
  failed: "Failed",
  paused: "Paused",
};

export const OUTCOME_TONES: Readonly<Record<TaskOutcome, NonNullable<BadgeProps["tone"]>>> = {
  done: "success",
  failed: "danger",
  paused: "warning",
};

export const OUTCOME_EDGES: Readonly<Record<TaskOutcome, CardEdge>> = {
  done: "done",
  failed: "failed",
  paused: "paused",
};

/** "1 needs you", "3 need you". */
export function needsYouWords(count: number): string {
  return count === 1 ? "needs you" : "need you";
}

/** "2 of 3 desks": the running Tasks against the Office-wide limit. */
export function desksWords({ desks }: Pick<Now, "desks">): string {
  return `${desks.inUse} of ${desks.limit} desks`;
}

/** "since 22:00" today, "since 25 Oct, 22:00" before; nothing until the user is first seen. */
export function sinceWords(leftAt: string | null, now: Date = new Date()): string | undefined {
  return leftAt === null ? undefined : `since ${momentWords(leftAt, now)}`;
}

/** "18 min in Stage", counted from the Stage's latest run. */
export function inStageWords({ since }: CurrentStage, now: Date = new Date()): string {
  return `${durationWords(Math.max(0, now.getTime() - Date.parse(since)))} in Stage`;
}

/** "resets 14:20"; nothing while the window has not begun. */
export function resetWords(resetsAt: string | null): string | undefined {
  return resetsAt === null ? undefined : `resets ${clockOf(resetsAt)}`;
}

/** How many of the outcomes since the user left are Done. */
export function doneSinceYouLeft({ sinceYouLeft }: Pick<Now, "sinceYouLeft">): number {
  return sinceYouLeft.filter(({ outcome }) => outcome === "done").length;
}
