import { countedTokens, type StageRun, type TaskStage, type Thread } from "@the-office/contracts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { clockOf } from "../../shell/time.ts";
import { stageNamesOf, withoutMarkdownMarks, type StageNames } from "./stage-words.ts";

/** What a Thread did on the Task's Stages. A Consultation has no run, so it did none of this. */
export interface ChapterWork {
  /** One Thread can span several runs and Stages, as a `continue` session resumes in it. */
  readonly stages: readonly { readonly key: string; readonly name: string }[];
  readonly handoverNote: string | undefined;
  /** The number of its latest run. */
  readonly runNumber: number | undefined;
  /** How its latest run stands. */
  readonly outcome: "Running" | "Failed" | "Done" | undefined;
  /** What sent its first run here, when that was a failure or a Gate. */
  readonly why: string | undefined;
  /** A line for each run it finished; a failed run has its own in the log. */
  readonly finishedRuns: readonly { readonly id: string; readonly words: string }[];
}

/** What a record's Decisions and Stages add to its Threads. */
export interface TimelineWork {
  readonly holdingOpenDecision: ReadonlySet<string>;
  /** Those of them whose Decision is the user's to answer, not a Consultant's. */
  readonly waitingOnYou: ReadonlySet<string>;
  /** The user confirmed the Plan, which is how a Planning Thread stands once its work is done. */
  readonly planConfirmed: boolean;
  readonly workOf: (threadId: string) => ChapterWork;
  /** A chapter's way to the rail. */
  readonly onShowStage: (stageKey: string) => void;
}

const NO_CHAPTER_WORK: ChapterWork = {
  stages: [],
  handoverNote: undefined,
  runNumber: undefined,
  outcome: undefined,
  why: undefined,
  finishedRuns: [],
};

/** A record with no Decisions and no Stages, as an Initiative is: its Threads are all it has. */
export const NO_TIMELINE_WORK: TimelineWork = {
  holdingOpenDecision: new Set(),
  waitingOnYou: new Set(),
  planConfirmed: false,
  workOf: () => NO_CHAPTER_WORK,
  onShowStage: () => undefined,
};

/**
 * Which chapters are unfolded, by Thread. A chapter once unfolded stays as it is until the user
 * folds it: a Decision answered, or a new Thread taken up, must not fold text under the reader.
 */
export type ChapterFolds = ReadonlyMap<string, boolean>;

/** The Threads in the order they started. They overlap, so when they ended says nothing. */
export function threadsInOrder(threads: readonly Thread[]): Thread[] {
  return threads.toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** The Thread the user is on starts unfolded, and so does any holding an open Decision. */
export function chaptersStartingOpen(
  shownId: string | undefined,
  holdingOpenDecision: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([...(shownId === undefined ? [] : [shownId]), ...holdingOpenDecision]);
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

/** Every Stage the Thread ran in, in Pipeline order, and how its runs stand. */
export function chapterWork(stages: readonly TaskStage[], threadId: string): ChapterWork {
  const worked = stages.flatMap(({ stage, runs }) => {
    const own = runs.filter((run) => run.threadId === threadId);
    return own.length > 0 ? [{ key: stage.key, name: stage.name, runs: own }] : [];
  });
  const runs = worked
    .flatMap(({ name, runs: own }) => own.map((run) => ({ name, run })))
    .toSorted((a, b) => a.run.number - b.run.number);
  const latest = runs.at(-1)?.run;
  const names = stageNamesOf(stages.map(({ stage }) => stage));
  return {
    stages: worked.map(({ key, name }) => ({ key, name })),
    handoverNote:
      runs.findLast(({ run }) => run.outcome?.handoverNote)?.run.outcome?.handoverNote ?? undefined,
    runNumber: latest?.number,
    outcome: latest && runOutcome(latest),
    why: runs[0] && whyItRan(runs[0].run, names),
    finishedRuns: runs.flatMap(({ name, run }) =>
      run.outcome?.status === "done" && !run.outcome.skipped
        ? [{ id: run.id, words: finishedRunWords(name, run) }]
        : [],
    ),
  };
}

function runOutcome({ outcome }: StageRun): ChapterWork["outcome"] {
  if (outcome === null) return "Running";
  return outcome.status === "failed" ? "Failed" : "Done";
}

function whyItRan({ carriedFailure, sentBack }: StageRun, names: StageNames): string | undefined {
  if (carriedFailure) {
    const { stageKey, round, rounds } = carriedFailure;
    return `${names(stageKey)} failed, round ${round} of ${rounds}`;
  }
  return sentBack ? `Sent back from ${names(sentBack.gateKey)}` : undefined;
}

/** "Implement · run 1 done · 212k tokens · 12:38". */
function finishedRunWords(name: string, { number, tokens, endedAt }: StageRun): string {
  return [
    `${name} · run ${number} done`,
    `${tokensShort(countedTokens(tokens))} tokens`,
    ...(endedAt === null ? [] : [clockOf(endedAt)]),
  ].join(" · ");
}

/** A chapter's place in the work: "Implement, run 6"; a Thread with no run is its title alone. */
export function chapterPlace(thread: Thread, { runNumber }: ChapterWork): string {
  const title = thread.title ?? "";
  return runNumber === undefined ? title : `${title}, run ${runNumber}`;
}

/** How a chapter stands: its latest run's outcome, or for Planning that the Plan was confirmed. */
export function chapterStanding(
  { stageThread, consultation }: Thread,
  { outcome }: ChapterWork,
  planConfirmed: boolean,
): string | undefined {
  if (outcome !== undefined) return outcome;
  return planConfirmed && !stageThread && consultation === null ? "Plan confirmed" : undefined;
}

/** A folded chapter's line: only what the page already has, so no Thread's messages are read. */
export function foldedLine(thread: Thread, handoverNote: string | undefined): string {
  const tokens = `${tokensShort(countedTokens(thread.tokens))} tokens`;
  return handoverNote === undefined ? tokens : `${tokens} · ${noteOnOneLine(handoverNote)}`;
}

/** A note's whole text, cut by the line's width: its first line may be only a heading. */
function noteOnOneLine(note: string): string {
  return note
    .split("\n")
    .map(withoutMarkdownMarks)
    .filter((line) => line.trim() !== "")
    .join(" ");
}
