import type { BadgeProps } from "@the-office/ui";
import type { CurrentStage, Engine, Now, TaskOutcome } from "@the-office/contracts";
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

/** "resets 14:20" today, "resets 30 Oct, 09:00" on another day; nothing while it has not begun. */
export function resetMomentWords(
  resetsAt: string | null,
  now: Date = new Date(),
): string | undefined {
  return resetsAt === null ? undefined : `resets ${momentWords(resetsAt, now)}`;
}

/** How many of the outcomes since the user left are Done. */
export function doneSinceYouLeft({ sinceYouLeft }: Pick<Now, "sinceYouLeft">): number {
  return sinceYouLeft.filter(({ outcome }) => outcome === "done").length;
}

export type UsageWindows = Now["usageWindows"][number];
export type UsageWindow = UsageWindows["fiveHour"];
export type NamedUsageWindows = UsageWindows & { readonly engineName: string };

/**
 * Each engine's usage windows, named and in the order Settings › Engines lists the engines; a
 * reading of an engine no longer listed comes last, by its id, until the service forgets it.
 */
export function namedUsageWindows(
  windows: readonly UsageWindows[],
  engines: readonly Pick<Engine, "id" | "name">[],
): NamedUsageWindows[] {
  const listed = engines.flatMap((engine) => {
    const window = windows.find(({ engineId }) => engineId === engine.id);
    return window ? [{ ...window, engineName: engine.name }] : [];
  });
  const unlisted = windows
    .filter(({ engineId }) => !engines.some(({ id }) => id === engineId))
    .map((window) => ({ ...window, engineName: window.engineId }));
  return [...listed, ...unlisted];
}

/** "Work account's 5-hour window", as the window's Notifications name it. */
export function fiveHourWindowName({ engineName }: Pick<NamedUsageWindows, "engineName">): string {
  return `${engineName}'s 5-hour window`;
}

/** "42%", as a usage window's use is shown. */
export function percentWords({ percentUsed }: Pick<UsageWindow, "percentUsed">): string {
  return `${Math.round(percentUsed)}%`;
}

/** Past this many engines the strip no longer shows each one's %, to stay small. */
const MOST_ENGINES_SHOWN_ONE_BY_ONE = 3;

/** A part of the strip's usage figure, as "5h 42%", its number to be set apart from its words. */
export interface UsageFigurePart {
  readonly before?: string;
  readonly figure: string;
  readonly after?: string;
  /** The engine the figure is of, where the words alone don't say. */
  readonly engineName?: string;
}

/**
 * The strip's usage figure, in parts shown with " · " between them: "5h 42% · 7d 17%" for one
 * engine, "5h 42% · 80% · 12%" for a few, "5h 80% max · 5 engines" past that; none until one is read.
 */
export function usageFigureWords(windows: readonly NamedUsageWindows[]): UsageFigurePart[] {
  const [first] = windows;
  if (!first) return [];
  if (windows.length === 1) {
    return [
      { before: "5h", figure: percentWords(first.fiveHour) },
      { before: "7d", figure: percentWords(first.sevenDay) },
    ];
  }
  if (windows.length > MOST_ENGINES_SHOWN_ONE_BY_ONE) {
    const highest = Math.max(...windows.map(({ fiveHour }) => fiveHour.percentUsed));
    return [
      { before: "5h", figure: percentWords({ percentUsed: highest }), after: "max" },
      { figure: String(windows.length), after: "engines" },
    ];
  }
  return windows.map(({ engineName, fiveHour }, index) => ({
    ...(index === 0 && { before: "5h" }),
    figure: percentWords(fiveHour),
    engineName,
  }));
}

/** "5-hour window: Home account 42%, Work account 80%", what the figure says for a screen reader. */
export function usageFigureLabel(windows: readonly NamedUsageWindows[]): string {
  const engines = windows.map(
    ({ engineName, fiveHour }) => `${engineName} ${percentWords(fiveHour)}`,
  );
  return `5-hour window: ${engines.join(", ")}`;
}
