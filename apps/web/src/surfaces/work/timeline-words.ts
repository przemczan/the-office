import { countedTokens, type StageRun, type TaskStage, type Thread } from "@the-office/contracts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import type { LogLine } from "../../shell/conversation/message-groups.ts";
import { clockOf } from "../../shell/time.ts";

/** What a Thread did on the Task's Stages. A Consultation has no run, so it did none of this. */
export interface ChapterWork {
  /** The number of its latest run. */
  readonly runNumber: number | undefined;
  /** The latest run's id, as the address names it. */
  readonly runId: string | undefined;
  /** A line for each run it finished; a failed run has its own in the log. */
  readonly finishedRuns: readonly LogLine[];
}

/**
 * Which chapters are unfolded, by Thread. A chapter once unfolded stays as it is until the user
 * folds it: a Decision answered, or a new Thread taken up, must not fold text under the reader.
 */
export type ChapterFolds = ReadonlyMap<string, boolean>;

/** The Threads in the order they started. They overlap, so when they ended says nothing. */
export function threadsInOrder(threads: readonly Thread[]): Thread[] {
  return threads.toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** The folds with those not yet decided unfolded. Unchanged folds come back as they were. */
export function withChaptersStarted(
  folds: ChapterFolds,
  startingOpen: ReadonlySet<string>,
): ChapterFolds {
  const added = [...startingOpen].filter((threadId) => !folds.has(threadId));
  if (added.length === 0) return folds;
  return new Map([...folds, ...added.map((threadId) => [threadId, true] as const)]);
}

export function withChapterOpen(
  folds: ChapterFolds,
  threadId: string,
  open: boolean,
): ChapterFolds {
  return new Map(folds).set(threadId, open);
}

/** The Thread's runs on the Task's Stages. One Thread can span several, as a `continue` session does. */
export function chapterWork(stages: readonly TaskStage[], threadId: string): ChapterWork {
  const runs = stages
    .flatMap(({ stage, runs: all }) =>
      all.filter((run) => run.threadId === threadId).map((run) => ({ name: stage.name, run })),
    )
    .toSorted((a, b) => a.run.number - b.run.number);
  const latest = runs.at(-1)?.run;
  return {
    runNumber: latest?.number,
    runId: latest?.id,
    finishedRuns: runs.flatMap(({ name, run }) =>
      run.outcome?.status === "done" && !run.outcome.skipped && run.endedAt !== null
        ? [{ id: run.id, at: run.endedAt, words: finishedRunWords(name, run, run.endedAt) }]
        : [],
    ),
  };
}

/** "Implement · run 1 done · 212k tokens · 12:38". */
function finishedRunWords(name: string, { number, tokens }: StageRun, endedAt: string): string {
  return [
    `${name} · run ${number} done`,
    `${tokensShort(countedTokens(tokens))} tokens`,
    clockOf(endedAt),
  ].join(" · ");
}

/** A chapter's place in the work: "Implement, run 6"; a Thread with no run is its title alone. */
export function chapterPlace(thread: Thread, { runNumber }: ChapterWork): string {
  const title = thread.title ?? "";
  return runNumber === undefined ? title : `${title}, run ${runNumber}`;
}

/** A folded chapter's line: only what the page already has, so no Thread's messages are read. */
export function foldedLine(thread: Thread): string {
  return `${tokensShort(countedTokens(thread.tokens))} tokens`;
}
