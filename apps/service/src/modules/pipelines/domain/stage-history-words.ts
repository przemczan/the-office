import { STAGE_KIND_NAMES, type Stage } from "./stage.js";
import type { CommandOutcome, StageCommandPurpose, StageCommandRun } from "./stage-command-run.js";
import type {
  GateAction,
  StageInterruption,
  StageOutcome,
  StageRun,
  StageRunDecision,
  WalkAnswer,
  WalkDecisionKind,
} from "./stage-run.js";

/**
 * How much of the Stage history read_stage_history answers with, as read_attachment caps a
 * document, so one long test run can't fill the session's context.
 */
export const STAGE_HISTORY_READ_LIMIT = 60_000;

/** Room kept for the lines saying what was cut, so the answer stays within the limit. */
const CUT_NOTE_ROOM = 120;

/**
 * A Task's Stage history as text (spec §2.3), in the order the runs ran: each run with its Stage,
 * its times, outcome, Handover note, Decisions, engine and tokens, and every Project command with
 * its filtered output. Capped as `STAGE_HISTORY_READ_LIMIT` says, each output keeping its end.
 */
export function stageHistoryWords(stages: readonly Stage[], runs: readonly StageRun[]): string {
  if (runs.length === 0) return "The Task has no Stage runs yet.";
  const parts = runs.flatMap((run) => [
    ...runParts(stages, run, filteredOutputs(run)),
    wordsPart("\n\n"),
  ]);
  return capped([
    wordsPart(
      `The Task's Stage runs, ${runs.length} in the order they ran. Each command shows its filtered output; read one run by its number for each command's whole output.\n\n`,
    ),
    ...parts.slice(0, -1),
  ]);
}

/**
 * One Stage run as text, as `stageHistoryWords` gives it but with each command's whole output in
 * place of its filtered one, as the Stage history shows it.
 */
export function stageRunWords(
  stages: readonly Stage[],
  run: StageRun,
  wholeOutputs: readonly string[],
): string {
  return capped(runParts(stages, run, wholeOutputs));
}

/** A piece of the answer: words kept whole, or a command's output, cut from its start to fit. */
type Part =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "output"; readonly text: string };

function wordsPart(words: string): Part {
  return { kind: "text", text: words };
}

function filteredOutputs(run: StageRun): string[] {
  return run.commandRuns.map(({ output }) => output);
}

function runParts(stages: readonly Stage[], run: StageRun, outputs: readonly string[]): Part[] {
  const lines = [
    `## Run ${run.number}: ${stageName(stages, run.stageKey)}`,
    "",
    timesLine(run),
    ...whyItRanLines(stages, run),
    outcomeWords(run.outcome),
    ...handoverNoteLines(run.outcome),
    ...gateActionLines(stages, run.gateAction),
    ...decisionLines(run.decisions),
    ...engineLines(run),
    tokensLine(run),
  ];
  return [wordsPart(lines.join("\n")), ...commandParts(run.commandRuns, outputs)];
}

function stageName(stages: readonly Stage[], stageKey: string): string {
  const stage = stages.find(({ key }) => key === stageKey);
  return stage
    ? `${stage.name} (${STAGE_KIND_NAMES[stage.kind]})`
    : `the Stage "${stageKey}" (no longer among the Task's Stages)`;
}

function timesLine({ startedAt, endedAt }: StageRun): string {
  const started = `Started ${startedAt.toISOString()}`;
  return endedAt === undefined
    ? `${started}, still running.`
    : `${started}, ended ${endedAt.toISOString()} (${durationWords(endedAt.getTime() - startedAt.getTime())}).`;
}

function whyItRanLines(
  stages: readonly Stage[],
  { stageKey, carriedFailure, sentBack }: StageRun,
): string[] {
  const lines: string[] = [];
  if (carriedFailure) {
    const which =
      carriedFailure.stageKey === stageKey
        ? "this Stage"
        : `"${nameOf(stages, carriedFailure.stageKey)}"`;
    lines.push(
      `Ran again as ${which} failed (round ${carriedFailure.round} of ${carriedFailure.rounds}).`,
    );
    if (carriedFailure.guidance !== undefined) {
      lines.push(
        `Guidance for the round${guideWords(carriedFailure.guidedBy)}: ${carriedFailure.guidance}`,
      );
    }
  }
  if (sentBack) {
    lines.push(
      `Sent back from "${nameOf(stages, sentBack.gateKey)}" with the user's feedback: ${sentBack.feedback}`,
    );
  }
  return lines;
}

function guideWords(guidedBy: string | undefined): string {
  return guidedBy === undefined ? ", from the user" : `, from the Role ${guidedBy}`;
}

function nameOf(stages: readonly Stage[], stageKey: string): string {
  return stages.find(({ key }) => key === stageKey)?.name ?? stageKey;
}

function outcomeWords(outcome: StageOutcome | undefined): string {
  if (!outcome) return "Outcome: none yet, as the run is still going on.";
  switch (outcome.status) {
    case "done":
      return outcome.skipped
        ? `Outcome: skipped. ${outcome.summary}`
        : `Outcome: done. ${outcome.summary}${pullRequestWords(outcome.pullRequestUrl)}`;
    case "needs-decision":
      return `Outcome: needs a decision. The Agent asked: "${outcome.question}"\nOptions: ${outcome.options.map((option, index) => `${index + 1}. ${option}`).join("; ")}. Recommended: ${outcome.recommendation.option}, as ${outcome.recommendation.reason}`;
    case "failed":
      return `Outcome: failed${failedWhy(outcome)}.\n${outcome.error}`;
  }
}

function pullRequestWords(url: string | undefined): string {
  return url === undefined ? "" : `\nPull request: ${url}`;
}

const INTERRUPTION_WORDS: Readonly<Record<StageInterruption, string>> = {
  stop: "stopped by the user",
  pause: "paused by the user",
  alarm: "held by the fire alarm",
  restart: "ended as The Office restarted",
};

function failedWhy(outcome: Extract<StageOutcome, { status: "failed" }>): string {
  const reasons = [
    outcome.interrupted && INTERRUPTION_WORDS[outcome.interrupted],
    outcome.notStarted && "recorded without starting, as The Office had restarted",
    outcome.cutShort && "its Agent's turn cut short",
    outcome.budgetReached &&
      `the Task's ${outcome.budgetReached.used} tokens reached the Stage's budget of ${outcome.budgetReached.budget}`,
    outcome.baseMoved && baseMovedWords(outcome.baseMoved.conflictedFiles),
    outcome.branchMoved && "the branch had moved outside The Office",
  ].filter((reason): reason is string => typeof reason === "string");
  return reasons.length === 0 ? "" : ` (${reasons.join("; ")})`;
}

function baseMovedWords(conflictedFiles: readonly string[]): string {
  return conflictedFiles.length === 0
    ? "the base branch moved on, and the branch can't be fast-forwarded onto it"
    : `the branch conflicts with the base branch in ${conflictedFiles.join(", ")}`;
}

function handoverNoteLines(outcome: StageOutcome | undefined): string[] {
  return outcome?.handoverNote === undefined ? [] : [`Handover note: ${outcome.handoverNote}`];
}

function gateActionLines(stages: readonly Stage[], action: GateAction | undefined): string[] {
  if (!action) return [];
  switch (action.kind) {
    case "continue":
      return ["At the Gate the user let the work continue."];
    case "send-back":
      return [
        `At the Gate the user sent the work back to "${nameOf(stages, action.stageKey)}": ${action.feedback}`,
      ];
    case "drop":
      return ["At the Gate the user dropped the Task."];
  }
}

const WALK_DECISION_WORDS: Readonly<Record<WalkDecisionKind, string>> = {
  "no-retries-left": "The Stage failed with no retries left",
  budget: "The Task's tokens reached the Stage's budget",
  "definition-of-done": "The Pipeline ended with the Definition of Done not reported met",
  restart: "The Office restarted during the Stage",
  "base-moved": "The branch conflicts with the base branch at Publish",
  "branch-moved": "The branch moved outside The Office",
};

function decisionLines(decisions: readonly StageRunDecision[]): string[] {
  if (decisions.length === 0) return [];
  return [
    "Decisions:",
    ...decisions.map((decision) => {
      const asked =
        decision.kind === "agent"
          ? `The Agent asked "${decision.question}"`
          : WALK_DECISION_WORDS[decision.kind];
      return `- ${asked}. ${answerWords(decision.answer)}`;
    }),
  ];
}

function answerWords(answer: WalkAnswer | undefined): string {
  if (!answer) return "Not answered yet.";
  switch (answer.kind) {
    case "answered":
      return `Answered: ${answer.answer}`;
    case "more-rounds":
      return `Answered: ${answer.rounds} more rounds.`;
    case "one-more-round":
      return `Answered: one more round${answer.guidedBy === undefined ? "" : `, chosen by the Role ${answer.guidedBy}`}${answer.guidance === undefined ? "." : `, with: ${answer.guidance}`}`;
    case "accept-issues":
      return "Answered: go on, with the failure accepted as an issue.";
    case "mark-done":
      return "Answered: mark the Task done.";
    case "raise-budget":
      return `Answered: raise the budget by ${answer.tokens} tokens.`;
    case "resolved-in-worktree":
      return "Answered: the user resolved the conflict in the worktree.";
    case "keep-branch":
      return `Answered: keep the branch as it is${answer.guidance === undefined ? "." : `, with: ${answer.guidance}`}`;
    case "drop":
      return "Answered: drop the Task.";
  }
}

function engineLines({ engineName, engineId, model }: StageRun): string[] {
  if (engineId === undefined && model === undefined) return [];
  const engine = engineName ?? engineId ?? "unknown";
  return [`Engine: ${engine}, model ${model ?? "unknown"}.`];
}

function tokensLine({ tokens }: StageRun): string {
  return `Tokens: ${tokens.input} input, ${tokens.output} output, ${tokens.cacheRead} cache read, ${tokens.cacheCreation} cache creation.`;
}

const PURPOSE_WORDS: Readonly<Record<StageCommandPurpose, string>> = {
  install: "Install",
  command: "Command",
  "re-run": "Re-run",
};

const OUTCOME_WORDS: Readonly<Record<CommandOutcome, string>> = {
  passed: "passed",
  failed: "failed",
  "could-not-run": "could not run",
  "timed-out": "timed out",
  stopped: "stopped by The Office",
};

function commandParts(commandRuns: readonly StageCommandRun[], outputs: readonly string[]): Part[] {
  if (commandRuns.length === 0) return [wordsPart("\n\nProject commands: none.")];
  return [
    wordsPart("\n\nProject commands:"),
    ...commandRuns.flatMap((command, index) => [
      wordsPart(`\n\n${index + 1}. ${commandHeading(command)}\n\n`),
      { kind: "output" as const, text: outputs[index] ?? command.output },
    ]),
  ];
}

function commandHeading({
  purpose,
  commandLine,
  outcome,
  exitCode,
  durationMs,
  movedFiles,
}: StageCommandRun): string {
  const exit = exitCode === undefined ? "no exit code" : `exit code ${exitCode}`;
  const moved =
    movedFiles && movedFiles.paths.length > 0
      ? `\n   Files the test run wrote, moved out of the worktree: ${movedFiles.paths.join(", ")}`
      : "";
  return `${PURPOSE_WORDS[purpose]}: \`${commandLine}\`, ${OUTCOME_WORDS[outcome]}, ${exit}, ${durationWords(durationMs)}.${moved}\n   Output:`;
}

function durationWords(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/**
 * The parts joined, each output in a fence of its own; when they exceed the limit, the outputs
 * share what the words leave, the shortest kept whole, each of the rest keeping its end.
 */
function capped(parts: readonly Part[]): string {
  const outputs = parts.filter(({ kind }) => kind === "output").map(({ text }) => text);
  const fixed = parts
    .filter(({ kind }) => kind === "text")
    .reduce((sum, { text }) => sum + text.length, 0);
  const fenceRoom = outputs.length * 16;
  const whole = fixed + fenceRoom + outputs.reduce((sum, output) => sum + output.length, 0);
  const shares =
    whole <= STAGE_HISTORY_READ_LIMIT
      ? outputs.map((output) => output.length)
      : fairShares(
          outputs.map((output) => output.length),
          STAGE_HISTORY_READ_LIMIT - fixed - fenceRoom - CUT_NOTE_ROOM * (outputs.length + 1),
        );
  let outputIndex = 0;
  let cut = 0;
  const joined = parts
    .map((part) => {
      if (part.kind === "text") return part.text;
      const share = shares[outputIndex++] ?? 0;
      if (share < part.text.length) cut += 1;
      return fenced(endOf(part.text, share));
    })
    .join("");
  const answer = cut === 0 ? joined : `${joined}\n\n${cutNote(cut)}`;
  return answer.length <= STAGE_HISTORY_READ_LIMIT ? answer : wordsCut(answer);
}

/** `budget` shared among `lengths`: each gets at most its own, the shortest first. */
function fairShares(lengths: readonly number[], budget: number): number[] {
  const shares = lengths.map(() => 0);
  let left = Math.max(0, budget);
  const shortestFirst = lengths
    .map((length, index) => ({ length, index }))
    .toSorted((one, other) => one.length - other.length);
  shortestFirst.forEach(({ length, index }, place) => {
    const share = Math.min(length, Math.floor(left / (shortestFirst.length - place)));
    shares[index] = share;
    left -= share;
  });
  return shares;
}

function endOf(output: string, share: number): string {
  if (share >= output.length) return output;
  const cut = output.length - share;
  return `… ${cut} characters cut from the start\n${output.slice(cut)}`;
}

/** The output in a fence longer than any run of backticks it holds, so it can't close it. */
function fenced(output: string): string {
  if (output.trim() === "") return "(It printed nothing.)";
  const longestRun = Math.max(2, ...(output.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  return `${fence}\n${output.trimEnd()}\n${fence}`;
}

function cutNote(outputsCut: number): string {
  return `This answer is capped at ${STAGE_HISTORY_READ_LIMIT} characters: the start of ${outputsCut === 1 ? "1 output was" : `${outputsCut} outputs were`} cut, each keeping its end.`;
}

/** Words alone past the limit, which no output's cut could bring under it: their end is cut. */
function wordsCut(answer: string): string {
  const note = `\n\n… the rest is cut: this answer is capped at ${STAGE_HISTORY_READ_LIMIT} characters.`;
  return `${answer.slice(0, STAGE_HISTORY_READ_LIMIT - note.length)}${note}`;
}
