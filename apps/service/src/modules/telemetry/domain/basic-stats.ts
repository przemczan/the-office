/** How many office days tokens per day covers, ending today (spec 2.11). */
export const STATS_DAYS = 30;

/** How many Tasks the top Tasks lists at most (spec 2.11). */
export const TOP_TASKS = 10;

/** Tokens split as the engine reports them. */
export interface StatsTokens {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

/** The top bar's Project filter: every Project, or those chosen. */
export type StatsProjectFilter = "all" | readonly string[];

/** A Stage run started this week: its Task, its tokens, and whether it retried its Stage. */
export interface StatsStageRun {
  readonly taskId: string;
  readonly tokens: StatsTokens;
  readonly retry: boolean;
}

export interface StatsTask {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
}

export interface TopTask {
  readonly taskId: string;
  readonly title: string;
  readonly projectId: string;
  /** Counted tokens: cache reads left out. */
  readonly tokens: number;
}

/** This week's figures that belong to a Task, so follow the Project filter. */
export interface WeekStats {
  /** Up to `TOP_TASKS`, most counted tokens first. */
  readonly topTasks: readonly TopTask[];
  readonly tasksDone: number;
  readonly stageRetries: number;
}

/**
 * Tokens as every count in The Office counts them: cache reads left out (spec 2.7, "Today's
 * figures").
 */
export function countedTokens({ input, output, cacheCreation }: StatsTokens): number {
  return input + output + cacheCreation;
}

/**
 * The start of this week on the service's clock: local midnight of the Monday of `now`'s calendar
 * day, Sunday belonging to the week begun six days before. It is made from the local calendar date,
 * as `officeDayOf` (Notifications) reads one, so the office day of the moment it answers is that
 * Monday's, across a change of clock.
 */
export function weekStartOf(now: Date): Date {
  const daysSinceMonday = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
}

/**
 * The week's top Tasks, Tasks done and Stage retries, each narrowed by the Project filter through
 * its Task's Project. A run or a done Task whose Task isn't among `tasks` is left out, as its
 * Project can't be told.
 */
export function weekStatsOf({
  runs,
  doneTaskIds,
  tasks,
  filter,
}: {
  readonly runs: readonly StatsStageRun[];
  readonly doneTaskIds: readonly string[];
  readonly tasks: readonly StatsTask[];
  readonly filter: StatsProjectFilter;
}): WeekStats {
  const shown = new Map(
    tasks.filter((task) => isShown(task.projectId, filter)).map((task) => [task.id, task]),
  );
  const shownRuns = runs.filter(({ taskId }) => shown.has(taskId));
  const tokensByTask = new Map<string, number>();
  for (const { taskId, tokens } of shownRuns) {
    tokensByTask.set(taskId, (tokensByTask.get(taskId) ?? 0) + countedTokens(tokens));
  }
  const topTasks = [...tokensByTask]
    .map(([taskId, tokens]) => {
      const { title, projectId } = shown.get(taskId)!;
      return { taskId, title, projectId, tokens };
    })
    .toSorted((one, other) => other.tokens - one.tokens || one.taskId.localeCompare(other.taskId))
    .slice(0, TOP_TASKS);
  return {
    topTasks,
    tasksDone: new Set(doneTaskIds.filter((taskId) => shown.has(taskId))).size,
    stageRetries: shownRuns.filter(({ retry }) => retry).length,
  };
}

function isShown(projectId: string, filter: StatsProjectFilter): boolean {
  return filter === "all" || filter.includes(projectId);
}
