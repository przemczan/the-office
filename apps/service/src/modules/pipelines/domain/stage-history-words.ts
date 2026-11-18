import { STAGE_KIND_NAMES, type Stage } from "./stage.js";
import { holdingUserWords } from "./stage-interruption.js";
import type { CommandOutcome, StageCommandPurpose, StageCommandRun } from "./stage-command-run.js";
import type {
  GateAction,
  PublishedWork,
  RefusedTurn,
  HoldingUser,
  StageDecision,
  StageInterruption,
  StageOutcome,
  StageRun,
  StageRunDecision,
  WalkAnswer,
  WalkDecisionKind,
} from "./stage-run.js";

/**
 * How much of the Stage history read_stage_history answers with, so one long test run can't fill
 * the session's context.
 */
export const STAGE_HISTORY_READ_LIMIT = 60_000;

/** Room kept for the lines saying what was cut, so the answer stays within the limit. */
const CUT_NOTE_ROOM = 120;

/** Room kept for each output's fence. */
const FENCE_ROOM = 16;

/**
 * How much of the answer the runs' words may take in the whole history, so their outputs keep the
 * rest: past it, the earliest runs are left out, as the latest are the ones a diagnosis needs.
 */
const HISTORY_WORDS_ROOM = STAGE_HISTORY_READ_LIMIT / 2;

/**
 * A Task's Stage history as text (spec §2.3), in the order the runs ran: each run with its Stage,
 * its times, outcome, Handover note, Decisions, engine and tokens, how many messages an Agent
 * Stage's run logged in its Stage Thread (`threadMessageCounts`, by the run's id), and every
 * Project command with its filtered output. Capped as `STAGE_HISTORY_READ_LIMIT` says: the earliest
 * runs are left out when their words alone would crowd the outputs out, and each output keeps its
 * end.
 */
export function stageHistoryWords(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  threadMessageCounts: ReadonlyMap<string, number>,
): string {
  if (runs.length === 0) return "The Task has no Stage runs yet.";
  const shown = latestRunsParts(
    runs.map((run) =>
      runParts(stages, run, filteredOutputs(run), threadCountLines(run, threadMessageCounts)),
    ),
  );
  const parts = shown.flatMap((run) => [...run, wordsPart("\n\n")]);
  return capped([
    wordsPart(`${historyHeading(runs.length, runs.length - shown.length)}\n\n`),
    ...parts.slice(0, -1),
  ]);
}

function historyHeading(runCount: number, leftOut: number): string {
  const order =
    leftOut === 0
      ? `The Task's Stage runs, ${runCount} in the order they ran.`
      : `The Task's Stage runs, ${runCount} in the order they ran: the ${leftOut} earliest are left out to keep this answer within ${STAGE_HISTORY_READ_LIMIT} characters.`;
  return `${order} Each command shows its filtered output; read one run by its number for each command's whole output and, for an Agent Stage, its Stage Thread's messages.`;
}

/** The latest runs whose words fit `HISTORY_WORDS_ROOM`, the last run always among them. */
function latestRunsParts(runsParts: readonly Part[][]): Part[][] {
  const shown: Part[][] = [];
  let room = HISTORY_WORDS_ROOM;
  for (const parts of runsParts.toReversed()) {
    const length = wordsLength(parts);
    if (shown.length > 0 && length > room) break;
    shown.unshift(parts);
    room -= length;
  }
  return shown;
}

function wordsLength(parts: readonly Part[]): number {
  return parts
    .filter(({ kind }) => kind === "text")
    .reduce((sum, { text }) => sum + text.length, 0);
}

/** The line naming how many messages the run's Stage Thread holds; none for a run without one. */
function threadCountLines(
  { id, number, threadId }: StageRun,
  threadMessageCounts: ReadonlyMap<string, number>,
): string[] {
  const count = threadMessageCounts.get(id);
  if (threadId === undefined || count === undefined) return [];
  const messages = count === 1 ? "1 message" : `${count} messages`;
  return [
    `Stage Thread: ${messages} logged during the run; read it with runNumber ${number} for them.`,
  ];
}

/**
 * One Stage run as text, as `stageHistoryWords` gives it but with each command's whole output in
 * place of its filtered one, as the Stage history shows it, and an Agent Stage's run ending with
 * its Stage Thread's messages (`threadWords`, worded within `stageRunThreadRoom`).
 */
export function stageRunWords(
  stages: readonly Stage[],
  run: StageRun,
  wholeOutputs: readonly string[],
  threadWords: string | undefined,
): string {
  const thread =
    threadWords === undefined ? [] : [wordsPart(`${threadHeading(run)}${threadWords}`)];
  return capped([...runParts(stages, run, wholeOutputs, []), ...thread]);
}

function threadHeading({ endedAt }: StageRun): string {
  return `\n\nStage Thread, its messages from the run's start to ${endedAt === undefined ? "now" : "its end"}:\n\n`;
}

/**
 * How many characters the run's Stage Thread messages may take in `stageRunWords`: the room the
 * run's other words leave is shared with the command outputs, each getting at least half of it and
 * the messages whatever the outputs don't need.
 */
export function stageRunThreadRoom(
  stages: readonly Stage[],
  run: StageRun,
  wholeOutputs: readonly string[],
): number {
  const parts = runParts(stages, run, wholeOutputs, []);
  const outputs = parts.filter(({ kind }) => kind === "output");
  const room =
    STAGE_HISTORY_READ_LIMIT -
    wordsLength(parts) -
    threadHeading(run).length -
    outputs.length * FENCE_ROOM -
    CUT_NOTE_ROOM * (outputs.length + 1);
  const outputsNeed = outputs.reduce((sum, { text }) => sum + text.length, 0);
  return Math.max(0, room - Math.min(outputsNeed, Math.floor(room / 2)));
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

function runParts(
  stages: readonly Stage[],
  run: StageRun,
  outputs: readonly string[],
  threadLines: readonly string[],
): Part[] {
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
    ...threadLines,
  ];
  return [wordsPart(lines.join("\n")), ...commandParts(stages, run.commandRuns, outputs)];
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
      return `Outcome: needs a decision. The Agent asked: "${outcome.question}"${optionWords(outcome)}`;
    case "failed":
      return `Outcome: failed${failedWhy(outcome)}.\n${outcome.error}`;
  }
}

/** The options of the Agent's question, when it was one choice: a form of several has none kept. */
function optionWords({ options, recommendation }: StageDecision): string {
  if (options.length === 0) return "";
  const listed = options.map((option, index) => `${index + 1}. ${option}`).join("; ");
  return `\nOptions: ${listed}. Recommended: ${recommendation.option}, as ${recommendation.reason}`;
}

function pullRequestWords(url: string | undefined): string {
  return url === undefined ? "" : `\nPull request: ${url}`;
}

/** How the run was interrupted, naming the user who paused or stopped it. */
function interruptionWords(
  interrupted: StageInterruption,
  heldByUser: HoldingUser | undefined,
): string {
  if (interrupted === "stop") return `stopped by ${holdingUserWords(heldByUser)}`;
  if (interrupted === "pause") return `paused by ${holdingUserWords(heldByUser)}`;
  return INTERRUPTION_WORDS[interrupted];
}

const INTERRUPTION_WORDS: Readonly<Record<Exclude<StageInterruption, "stop" | "pause">, string>> = {
  alarm: "held by the fire alarm",
  "usage-window": "paused as the engine's usage window was used up",
  restart: "cut short as The Office restarted, its edits kept for the Stage to go on with",
};

function failedWhy(outcome: Extract<StageOutcome, { status: "failed" }>): string {
  const reasons = [
    outcome.interrupted && interruptionWords(outcome.interrupted, outcome.heldByUser),
    outcome.notStarted && "recorded without starting, as The Office had restarted",
    outcome.cutShort && "its Agent's turn cut short",
    outcome.refused && refusedWords(outcome.refused),
    outcome.budgetReached &&
      `the Task's ${outcome.budgetReached.used} tokens reached the Stage's budget of ${outcome.budgetReached.budget}`,
    outcome.baseMoved && baseMovedWords(outcome.baseMoved.conflictedFiles),
    outcome.branchMoved && "the branch had moved outside The Office",
    outcome.afterPublishingFailed && publishedWords(outcome.afterPublishingFailed),
  ].filter((reason): reason is string => typeof reason === "string");
  return reasons.length === 0 ? "" : ` (${reasons.join("; ")})`;
}

/** "the engine refused the correction: Claude Code's 5-hour window is used up until …". */
function refusedWords({ message, engineName, windowWords, resetsAt }: RefusedTurn): string {
  const refused = message === "work" ? "the Stage's work" : "the correction";
  return `the engine refused ${refused}: ${engineName}'s ${windowWords} is used up until ${resetsAt}`;
}

function publishedWords({ kind, branch, pullRequestUrl }: PublishedWork): string {
  return kind === "merged"
    ? `${branch} was merged before the after publishing line failed`
    : `${branch} was pushed and the pull request ${pullRequestUrl ?? ""} opened before the after publishing line failed`;
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
  const user = holdingUserWords(action.byUser);
  switch (action.kind) {
    case "continue":
      return action.feedback === undefined
        ? [`At the Gate ${user} let the work continue.`]
        : [`At the Gate ${user} let the work continue: ${action.feedback}`];
    case "send-back":
      return [
        `At the Gate ${user} sent the work back to "${nameOf(stages, action.stageKey)}": ${action.feedback}`,
      ];
    case "drop":
      return [`At the Gate ${user} dropped the Task.`];
  }
}

const WALK_DECISION_WORDS: Readonly<Record<WalkDecisionKind, string>> = {
  "no-retries-left": "The Stage failed with no retries left",
  budget: "The Task's tokens reached the Stage's budget",
  // Asked before Publish, or as a Pipeline without one ended.
  "definition-of-done": "The Definition of Done wasn't reported met",
  restart: "The Office restarted during the Stage",
  "base-moved": "The branch conflicts with the base branch at Publish",
  "branch-moved": "The branch moved outside The Office",
  "after-publishing-failed": "Publish shipped the work, but the after publishing line failed",
  "no-route-holds": "None of the Stage's routes held",
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
      return "Answered: call the Definition of Done met.";
    case "raise-budget":
      return `Answered: raise the budget by ${answer.tokens} tokens.`;
    case "resolved-in-worktree":
      return "Answered: the user resolved the conflict in the worktree.";
    case "keep-branch":
      return `Answered: keep the branch as it is${answer.guidance === undefined ? "." : `, with: ${answer.guidance}`}`;
    case "follow-route":
      return `Answered: ${answer.to === null ? "end the Pipeline here" : `go on to the Stage "${answer.to}"`}${answer.guidance === undefined ? "." : `, with: ${answer.guidance}`}`;
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
  "before-publishing": "Before publishing",
  "after-publishing": "After publishing",
  condition: "Condition",
};

const OUTCOME_WORDS: Readonly<Record<CommandOutcome, string>> = {
  passed: "passed",
  failed: "failed",
  "could-not-run": "could not run",
  "timed-out": "timed out",
  stopped: "stopped by The Office",
};

function commandParts(
  stages: readonly Stage[],
  commandRuns: readonly StageCommandRun[],
  outputs: readonly string[],
): Part[] {
  if (commandRuns.length === 0) return [wordsPart("\n\nProject commands: none.")];
  return [
    wordsPart("\n\nProject commands:"),
    ...commandRuns.flatMap((command, index) => [
      wordsPart(`\n\n${index + 1}. ${commandHeading(stages, command)}\n\n`),
      { kind: "output" as const, text: outputs[index] ?? command.output },
    ]),
  ];
}

function commandHeading(
  stages: readonly Stage[],
  { purpose, commandLine, outcome, exitCode, durationMs, movedFiles, condition }: StageCommandRun,
): string {
  const exit = exitCode === undefined ? "no exit code" : `exit code ${exitCode}`;
  const moved =
    movedFiles && movedFiles.paths.length > 0
      ? `\n   Files the test run wrote, moved out of the worktree: ${movedFiles.paths.join(", ")}`
      : "";
  const forCondition = condition ? conditionWords(stages, purpose, condition.to) : "";
  return `${PURPOSE_WORDS[purpose]}${forCondition}: \`${commandLine}\`, ${OUTCOME_WORDS[outcome]}, ${exit}, ${durationWords(durationMs)}.${moved}\n   Output:`;
}

/** Which route a condition command, or the install before it, was run for. */
function conditionWords(
  stages: readonly Stage[],
  purpose: StageCommandPurpose,
  to: string | null,
): string {
  const route = `the route to ${to === null ? "End" : nameOf(stages, to)}`;
  return purpose === "condition" ? ` for ${route}` : ` for the condition of ${route}`;
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
  const fixed = wordsLength(parts);
  const fenceRoom = outputs.length * FENCE_ROOM;
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
