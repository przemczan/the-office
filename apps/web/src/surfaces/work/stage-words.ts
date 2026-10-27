import type {
  ContextMove,
  GateAction,
  Stage,
  StageRun,
  StageState,
  TaskStage,
  Thread,
} from "@the-office/contracts";
import { threadTokens, tokensShort } from "../../shell/conversation/context-words.ts";
import { durationWords } from "../../shell/time.ts";

/**
 * The words of the Task page's Stages block (prototypes/app/task.js): "Done · 18 min · 41k tokens ·
 * fresh session", then what the Stage's latest run came to.
 */

export const STAGE_STATE_WORDS: Readonly<Record<StageState, string>> = {
  pending: "Pending",
  running: "Running",
  "waiting-on-you": "Waiting on you",
  paused: "Paused",
  stopped: "Stopped",
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

/** The Task's Pipeline as its Stages block names it, saying when it was edited for the Task. */
export function pipelineLabel(pipelineName: string, editedForTask: boolean): string {
  return editedForTask ? `${pipelineName} · edited for this Task` : pipelineName;
}

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
  const { outcome, carriedFailure, sentBack } = latest;
  if (!outcome) {
    if (carriedFailure) {
      return `round ${carriedFailure.round} of ${carriedFailure.rounds} after ${names(carriedFailure.stageKey)} failed`;
    }
    return sentBack ? `sent back from ${names(sentBack.gateKey)}` : undefined;
  }
  switch (outcome.status) {
    case "done":
      if (outcome.skipped) return "the Definition of Done was already met";
      if (stage.kind === "gate")
        return latest.gateAction ? gateActionWords(latest.gateAction, names) : undefined;
      // An Agent's summary is in its Handover note and Thread; a script's is its command's result.
      if (stage.kind !== "script") return undefined;
      // A Script Stage can't read a Gate's feedback: the row tells it ran again for it.
      return sentBack
        ? `${outcome.summary} · sent back from ${names(sentBack.gateKey)}`
        : outcome.summary;
    case "needs-decision":
      return outcome.question;
    case "failed": {
      const why = outcome.budgetReached
        ? `reached its budget: ${tokensShort(outcome.budgetReached.used)} of ${tokensShort(outcome.budgetReached.budget)} tokens`
        : headLine(outcome.error);
      return wentBack
        ? `${why} · back to ${names(wentBack.stageKey)}, round ${wentBack.round} of ${wentBack.rounds}`
        : why;
    }
  }
}

/** What the user did at a Gate, as its Stage row says it. */
function gateActionWords(action: GateAction, names: StageNames): string {
  switch (action.kind) {
    case "continue":
      return "continued";
    case "send-back":
      return `sent back to ${names(action.stageKey)}`;
    case "drop":
      return "dropped the Task";
  }
}

/** A result's first line, its Markdown code spans as plain words, for a plain-text tooltip. */
export function firstLine(text: string): string {
  return plain(headLine(text));
}

/** A result's first line, still in Markdown. */
function headLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

/** The Office writes commands in Markdown code spans; the line shows them as plain words. */
function plain(text: string): string {
  return text.replaceAll("`", "");
}

/**
 * The Task's tokens: every token of every Thread on it, as the Stages' tokens count them. They
 * include a running turn's tokens so far, so they move mid-turn.
 */
export function taskTokens(threads: readonly Pick<Thread, "tokens">[] | undefined): number {
  return (threads ?? []).reduce((sum, thread) => sum + threadTokens(thread), 0);
}
