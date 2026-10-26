import type { ContextMove, Stage, StageRun, StageState, TaskStage } from "@the-office/contracts";
import { tokensShort } from "../../shell/conversation/context-words.ts";

/**
 * The words of the Task page's Stages block (prototypes/app/task.js): "Done · 18 min · 41k tokens ·
 * fresh session", then what the Stage's latest run came to.
 */

export const STAGE_STATE_WORDS: Readonly<Record<StageState, string>> = {
  pending: "Pending",
  running: "Running",
  "waiting-on-you": "Waiting on you",
  done: "Done",
  skipped: "Skipped",
  failed: "Failed",
};

const SESSION_WORDS: Readonly<Record<ContextMove, string>> = {
  resume: "continued session",
  fresh: "fresh session",
  "hand-off": "hand-off with a Brief",
};

/** Names a Stage by its key, as the Stages it is among call it. */
export type StageNames = (key: string) => string;

export function stageNamesOf(stages: readonly Stage[]): StageNames {
  return (key) => stages.find((stage) => stage.key === key)?.name ?? key;
}

/** "Optional · on failure back to Implement, at most 3×": what a Stage not yet run will do. */
export function stageRule(stage: Stage, names: StageNames): string[] {
  const onFailure = stage.kind !== "gate" ? stage.onFailure : undefined;
  return [
    stage.optional ? "optional" : undefined,
    onFailure && `on failure back to ${names(onFailure.goBackTo)}, at most ${onFailure.rounds}×`,
  ].filter((part) => part !== undefined);
}

/** The line under a started Task's Stage: its state, time, tokens, session and latest result. */
export function stageProgressLine(
  taskStage: TaskStage,
  names: StageNames,
  now: Date = new Date(),
): string {
  const { state, runs, tokens } = taskStage;
  const latest = runs.at(-1);
  if (state === "pending" || !latest) {
    return [STAGE_STATE_WORDS.pending, ...stageRule(taskStage.stage, names)].join(" · ");
  }
  return [
    STAGE_STATE_WORDS[state],
    state !== "skipped" ? durationWords(timeTaken(runs, now)) : undefined,
    tokens > 0 ? `${tokensShort(tokens)} tokens` : undefined,
    latest.session ? SESSION_WORDS[latest.session] : undefined,
    resultWords(taskStage, latest, names),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

/** The latest Handover note an Agent wrote at the Stage, if any. */
export function latestHandoverNote({ runs }: TaskStage): string | undefined {
  return runs.findLast((run) => run.outcome?.handoverNote)?.outcome?.handoverNote ?? undefined;
}

/** The command line a Script Stage ran, as the Project names it, once it has run it. */
export function scriptCommandLine({ runs }: TaskStage): string | undefined {
  return runs
    .flatMap(({ commandRuns }) => commandRuns)
    .findLast(({ purpose }) => purpose === "command")?.commandLine;
}

/** "18 min", "1h 10 min"; under a minute as "<1 min". */
export function durationWords(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest} min`;
}

/** Every run's time, a running one's until now. */
function timeTaken(runs: readonly StageRun[], now: Date): number {
  return runs.reduce((sum, run) => {
    const end = run.endedAt ? Date.parse(run.endedAt) : now.getTime();
    return sum + Math.max(0, end - Date.parse(run.startedAt));
  }, 0);
}

function resultWords(
  { stage, wentBack }: TaskStage,
  latest: StageRun,
  names: StageNames,
): string | undefined {
  const { outcome, carriedFailure } = latest;
  if (!outcome) {
    return carriedFailure
      ? `round ${carriedFailure.round} of ${carriedFailure.rounds} after ${names(carriedFailure.stageKey)} failed`
      : undefined;
  }
  switch (outcome.status) {
    case "done":
      if (outcome.skipped) return "the Definition of Done was already met";
      // An Agent's summary is in its Handover note and Thread; a script's is its command's result.
      return stage.kind === "script" ? plain(outcome.summary) : undefined;
    case "needs-decision":
      return outcome.question;
    case "failed": {
      const why = outcome.budgetReached
        ? `reached its budget: ${tokensShort(outcome.budgetReached.used)} of ${tokensShort(outcome.budgetReached.budget)} tokens`
        : firstLine(outcome.error);
      return wentBack
        ? `${why} · back to ${names(wentBack.stageKey)}, round ${wentBack.round} of ${wentBack.rounds}`
        : why;
    }
  }
}

function firstLine(text: string): string {
  return plain(text.split("\n", 1)[0] ?? "");
}

/** The Office writes commands in Markdown code spans; the line shows them as plain words. */
function plain(text: string): string {
  return text.replaceAll("`", "");
}
