import type { BadgeProps } from "@the-office/ui";
import {
  WINDOW_NEARLY_USED_PERCENT,
  type CurrentStage,
  type Engine,
  type Now,
  type TaskOutcome,
} from "@the-office/contracts";
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

/** How close a usage window is to used up: amber from "Window nearly used", red once it is. */
export type UsageTone = "calm" | "nearly-used" | "used-up";

export function usageTone({ percentUsed }: Pick<UsageWindow, "percentUsed">): UsageTone {
  if (percentUsed >= 100) return "used-up";
  if (percentUsed >= WINDOW_NEARLY_USED_PERCENT) return "nearly-used";
  return "calm";
}

/** How much of a usage window's meter is filled, 0 to 100. */
export function meterFilled({ percentUsed }: Pick<UsageWindow, "percentUsed">): number {
  return Math.min(100, Math.max(0, percentUsed));
}

/** One 5-hour window the strip's usage figure shows: its %, how full its meter is, its tone. */
export interface UsageReading {
  readonly engineName: string;
  readonly percent: string;
  /** How much of the meter is filled, 0 to 100. */
  readonly filled: number;
  readonly tone: UsageTone;
}

/**
 * The strip's usage figure: `one` engine's 5-hour window with its 7-day one after it, `each` of two
 * or three engines' 5-hour windows, or past that the `highest` of them.
 */
export interface UsageFigureWords {
  readonly shows: "one" | "each" | "highest";
  /** After its label "5-hour window": "resets 14:20", "used up until 14:20" or "3 engines". */
  readonly detail: string | undefined;
  readonly readings: readonly UsageReading[];
  /** After the readings: "7d 17%" for one engine, "highest" past three. */
  readonly after: string | undefined;
}

/** The strip's usage figure; none until an engine's windows are read. */
export function usageFigureWords(
  windows: readonly NamedUsageWindows[],
): UsageFigureWords | undefined {
  const [first] = windows;
  if (!first) return undefined;
  if (windows.length === 1) {
    return {
      shows: "one",
      detail: oneEngineDetail(first.fiveHour),
      readings: [readingOf(first)],
      after: `7d ${percentWords(first.sevenDay)}`,
    };
  }
  const detail = `${windows.length} engines`;
  if (windows.length > MOST_ENGINES_SHOWN_ONE_BY_ONE) {
    const highest = windows.reduce((top, engine) =>
      engine.fiveHour.percentUsed > top.fiveHour.percentUsed ? engine : top,
    );
    return { shows: "highest", detail, readings: [readingOf(highest)], after: "highest" };
  }
  return { shows: "each", detail, readings: windows.map(readingOf), after: undefined };
}

function oneEngineDetail(fiveHour: UsageWindow): string | undefined {
  if (usageTone(fiveHour) !== "used-up") return resetWords(fiveHour.resetsAt);
  return fiveHour.resetsAt === null ? "used up" : `used up until ${clockOf(fiveHour.resetsAt)}`;
}

function readingOf({ engineName, fiveHour }: NamedUsageWindows): UsageReading {
  return {
    engineName,
    percent: percentWords(fiveHour),
    filled: meterFilled(fiveHour),
    tone: usageTone(fiveHour),
  };
}

/** "5-hour window: Home account 42%, Work account 80%", what the figure says for a screen reader. */
export function usageFigureLabel(windows: readonly NamedUsageWindows[]): string {
  const engines = windows.map(
    ({ engineName, fiveHour }) => `${engineName} ${percentWords(fiveHour)}`,
  );
  return `5-hour window: ${engines.join(", ")}`;
}
