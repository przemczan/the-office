import { countedTokens, type DaySummary, type TaskKind } from "@the-office/contracts";
import { KIND_NAMES } from "../../shell/work/work-words.ts";

/** What a day's counts line and its groups are anchored by, so a count can jump to its group. */
export type DayGroup = "initiatives" | "tasks" | "pull-requests" | "failed";

/** One count of the line: its words and the group it jumps to. */
export interface DayCount {
  readonly group: DayGroup;
  readonly words: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** A real calendar day written `YYYY-MM-DD`, as the `?day=` address takes. */
export function isCalendarDay(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * The day `count` days from `day`, by calendar arithmetic on its text alone: no timezone and
 * never the browser's clock.
 */
export function addDays(day: string, count: number): string {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, date + count));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1, 2)}-${pad(moved.getUTCDate(), 2)}`;
}

/** "Thursday 26 November 2026". */
export function dayWords(day: string): string {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
  return `${weekday} ${date} ${MONTHS[month - 1]} ${year}`;
}

/** The page's heading: today's reads "Today, so far". */
export function dayHeading(day: string, today: string): string {
  return day === today ? "Today, so far" : dayWords(day);
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The counts of the groups that hold something, in the groups' order. */
export function dayCounts(summary: DaySummary): readonly DayCount[] {
  const counts: DayCount[] = [];
  const { initiativesDone, tasksDone, pullRequestsMerged, failedOrDropped } = summary;
  if (tasksDone.length > 0) {
    counts.push({ group: "tasks", words: `${counted(tasksDone.length, "Task", "Tasks")} done` });
  }
  if (pullRequestsMerged.length > 0) {
    counts.push({
      group: "pull-requests",
      words: `${counted(pullRequestsMerged.length, "pull request", "pull requests")} merged`,
    });
  }
  if (initiativesDone.length > 0) {
    counts.push({
      group: "initiatives",
      words: `${counted(initiativesDone.length, "Initiative", "Initiatives")} done`,
    });
  }
  if (failedOrDropped.length > 0) {
    counts.push({ group: "failed", words: `${failedOrDropped.length} failed or dropped` });
  }
  return counts;
}

export type AlsoGroup = "ideas" | "tasks-started";

/** The "Also that day" line's parts, each opening its list: "4 Ideas captured". */
export function alsoCounts(
  summary: DaySummary,
): readonly { readonly group: AlsoGroup; readonly words: string }[] {
  const parts: { group: AlsoGroup; words: string }[] = [];
  if (summary.ideasCaptured.length > 0) {
    parts.push({
      group: "ideas",
      words: `${counted(summary.ideasCaptured.length, "Idea", "Ideas")} captured`,
    });
  }
  if (summary.tasksStarted.length > 0) {
    parts.push({
      group: "tasks-started",
      words: `${counted(summary.tasksStarted.length, "Task", "Tasks")} started`,
    });
  }
  return parts;
}

/** Whether nothing at all is recorded for the day in the Projects shown. */
export function isEmptyDay(summary: DaySummary): boolean {
  return (
    dayCounts(summary).length === 0 &&
    alsoCounts(summary).length === 0 &&
    countedTokens(summary.tokens) === 0
  );
}

/**
 * What an empty day says: "Nothing finished today yet.", "Nothing was finished on Thursday 26
 * November 2026.", with "in these Projects" when the Project filter hides records elsewhere.
 */
export function emptyDayWords(day: string, today: string, elsewhere: number): string {
  const where = elsewhere > 0 ? " in these Projects" : "";
  return day === today
    ? `Nothing finished today yet${where}.`
    : `Nothing was finished on ${dayWords(day)}${where}.`;
}

/** "3 Tasks" for an Initiative's row. */
export function initiativeTasksWords(taskCount: number): string {
  return counted(taskCount, "Task", "Tasks");
}

/** A Task's row says what it is: "Feature", or "Feature · pull request #12". */
export function taskDoneWords(kind: TaskKind, pullRequestNumber: number | null): string {
  return pullRequestNumber === null
    ? KIND_NAMES[kind]
    : `${KIND_NAMES[kind]} · pull request #${pullRequestNumber}`;
}

/** A failure names the Stage it failed at, when one is named. */
export function failedStageWords(stageName: string | null): string | undefined {
  return stageName === null ? undefined : `Failed at ${stageName}`;
}
