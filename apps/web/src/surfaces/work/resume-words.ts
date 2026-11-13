import type { StageRun, TaskStage, Thread } from "@the-office/contracts";
import { contextLabel } from "../../shell/conversation/context-words.ts";

/**
 * What Resume does to a Paused Task (spec §2.4, §2.5), for its button: its label says how the
 * Task goes on, its hint says why.
 */
export interface ResumeWords {
  readonly label: string;
  readonly hint: string;
}

/** What Resume goes by: the Task's latest run, its Stage Thread, and whether a Decision waits. */
export interface HeldWork {
  /** The latest of the Task's runs, the one the user held, if the Task has run. */
  readonly latestRun: StageRun | undefined;
  /** The latest run's Stage Thread, once read; undefined for a Script Stage's run. */
  readonly thread: Thread | undefined;
  /** The person who works the latest run's Stage. */
  readonly personName: string;
  /** A Decision on the Task still waits on the user. */
  readonly decisionOpen: boolean;
}

const SESSION_LABELS: Readonly<Record<Thread["context"]["move"], (person: string) => string>> = {
  resume: (person) => `Resume · continues ${person}'s session`,
  fresh: () => "Resume · fresh session with a Brief",
  "hand-off": () => "Resume · hand-off with a Brief",
};

export function resumeWords({
  latestRun,
  thread,
  personName,
  decisionOpen,
}: HeldWork): ResumeWords {
  if (decisionOpen) {
    return {
      label: "Resume · after your answer",
      hint: "The Task waits on your answer to its Decision, then goes on.",
    };
  }
  if (latestRun && beginsAnew(latestRun)) {
    return {
      label: SESSION_LABELS.fresh(personName),
      hint: "The engine refused the Stage's first turn, which left no session, so the Stage begins again with its full Brief.",
    };
  }
  if (latestRun && goesOnInItsThread(latestRun) && thread) {
    return {
      label: SESSION_LABELS[thread.context.move](personName),
      hint: `The Stage runs again in its Thread: ${contextLabel(thread.context, personName)}.`,
    };
  }
  if (latestRun?.outcome?.status === "failed" && latestRun.outcome.interrupted === "restart") {
    return {
      label: "Resume · asks before running it again",
      hint: "The Office restarted during the Stage, so it asks you before the Stage runs again.",
    };
  }
  return { label: "Resume", hint: "The Pipeline goes on from where you paused it." };
}

/** A run held by a used-up usage window whose refused first turn left no session to go on in. */
function beginsAnew({ outcome }: StageRun): boolean {
  return outcome?.status === "failed" && outcome.refusedTurn?.sessionLeft === false;
}

/** A run still ending its turn, or one the user held, goes on in its Stage Thread. */
function goesOnInItsThread({ threadId, outcome }: StageRun): boolean {
  if (threadId === null) return false;
  if (!outcome) return true;
  return (
    outcome.status === "failed" &&
    (outcome.interrupted === "pause" ||
      outcome.interrupted === "stop" ||
      outcome.interrupted === "usage-window")
  );
}

/** The Task's latest run among its Stages, with the Stage it ran. */
export function latestRunOf(
  taskStages: readonly TaskStage[],
): { readonly run: StageRun; readonly taskStage: TaskStage } | undefined {
  let latest: { run: StageRun; taskStage: TaskStage } | undefined;
  for (const taskStage of taskStages) {
    for (const run of taskStage.runs) {
      if (!latest || run.number > latest.run.number) latest = { run, taskStage };
    }
  }
  return latest;
}
