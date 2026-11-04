import { countedTokens, type TaskStage, type Thread } from "@the-office/contracts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { withoutMarkdownMarks } from "./stage-words.ts";

/** What a Thread did on the Task's Stages. A Consultation has no run, so it did none of this. */
export interface ChapterWork {
  /** One Thread can span several runs and Stages, as a `continue` session resumes in it. */
  readonly stages: readonly { readonly key: string; readonly name: string }[];
  readonly handoverNote: string | undefined;
}

/** What a record's Decisions and Stages add to its Threads. */
export interface TimelineWork {
  readonly holdingOpenDecision: ReadonlySet<string>;
  /** Those of them whose Decision is the user's to answer, not a Consultant's. */
  readonly waitingOnYou: ReadonlySet<string>;
  readonly workOf: (threadId: string) => ChapterWork;
  /** A chapter's way to the rail. */
  readonly onShowStage: (stageKey: string) => void;
}

/** A record with no Decisions and no Stages, as an Initiative is: its Threads are all it has. */
export const NO_TIMELINE_WORK: TimelineWork = {
  holdingOpenDecision: new Set(),
  waitingOnYou: new Set(),
  workOf: () => ({ stages: [], handoverNote: undefined }),
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

/** Every Stage the Thread ran in, in Pipeline order, and the latest Handover note it left. */
export function chapterWork(stages: readonly TaskStage[], threadId: string): ChapterWork {
  const worked = stages.flatMap(({ stage, runs }) => {
    const own = runs.filter((run) => run.threadId === threadId);
    return own.length > 0 ? [{ key: stage.key, name: stage.name, runs: own }] : [];
  });
  const notes = worked
    .flatMap(({ runs }) => runs)
    .flatMap(({ startedAt, outcome }) =>
      outcome?.handoverNote ? [{ startedAt, note: outcome.handoverNote }] : [],
    )
    .toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  return {
    stages: worked.map(({ key, name }) => ({ key, name })),
    handoverNote: notes.at(-1)?.note,
  };
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
