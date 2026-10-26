import type { AllowedCommands } from "./allowed-commands.js";
import { STAGE_KIND_NAMES, type AgentStage, type StageKind } from "./stage.js";
import type { CarriedFailure, StageInterruption, StageOutcome } from "./stage-run.js";

/**
 * What an Agent does in a Stage Thread, after their card's instructions: the same for every Stage
 * of every Task, so it stays in the cached prefix.
 */
export const AGENT_STAGE_INSTRUCTIONS =
  "In this Thread you work Stages of a Task's Pipeline, in the Task's worktree. Each Stage comes as a message saying what it asks, after the Task's Brief when your session is new. Work it through, checking your work with the commands you may run, which the Brief names. The Office commits your work after each Stage: you never commit, push or switch branches. End the Stage with your result: done, with a summary, the numbers of the Definition of Done statements the work now meets, and your Handover note (where you are, what is left, what to watch); needs_decision, when a choice is the user's to make, with the question, what they need to know, the options and the one you recommend; or failed, with the reason, when you can't finish it.";

/** The Task's record, as an Agent Stage's Brief has it. */
export interface BriefTask {
  readonly title: string;
  readonly plan: string;
  readonly definitionOfDone: readonly string[];
  /** Each of the Task's Attachments, as a line of the Brief. */
  readonly attachmentLines: readonly string[];
  readonly projectName: string;
  readonly baseBranch: string;
  readonly worktree: { readonly path: string; readonly branch: string };
}

/** A Stage run before this one, with how it ended. */
export interface EarlierResult {
  readonly stageName: string;
  readonly kind: StageKind;
  readonly outcome: StageOutcome;
}

/** What an Agent Stage's Brief is assembled from: the record, with no model call (spec §2.5). */
export interface AgentStageRecord {
  readonly task: BriefTask;
  /** In the order they ran. */
  readonly earlier: readonly EarlierResult[];
  /** What changed on the Task's branch so far; undefined when it isn't known. */
  readonly diffSummary: string | undefined;
  readonly commands: AllowedCommands;
}

/**
 * The record a new session of an Agent Stage starts from (spec §2.5): the Task's title, Plan and
 * Definition of Done, where the session works, the earlier Stages' results with their Handover
 * notes, the diff so far, the Attachments and the commands the Agent may run. Conversations adds
 * the answered Decisions; transcripts are never handed over.
 */
export function agentStageRecord({
  task,
  earlier,
  diffSummary,
  commands,
}: AgentStageRecord): string {
  return sections([
    `## The Task\n\n${task.title}, in the Project ${task.projectName}.`,
    `## Where you work\n\nThe Task's worktree, at ${task.worktree.path} on the branch ${task.worktree.branch}, which started from ${task.baseBranch}.`,
    task.plan === "" ? undefined : `## The Plan\n\n${task.plan}`,
    task.definitionOfDone.length === 0
      ? undefined
      : `## The Definition of Done\n\n${task.definitionOfDone.map((statement, index) => `${index + 1}. ${statement}`).join("\n")}`,
    earlier.length === 0
      ? undefined
      : `## Earlier Stages\n\n${earlier.map(earlierResultWords).join("\n")}`,
    diffSummary === undefined ? undefined : `## What changed so far\n\n${diffSummary}`,
    attachmentsSection(task.attachmentLines),
    `## Commands you may run\n\n${commands.words}`,
    // Claude Code asks approval for `cd <absolute path> && …` whatever the hook allows, which
    // fails an unattended Stage (task 12's check on the Test Project).
    "Run them in the worktree, where your session starts, with paths relative to it; never `cd` to an absolute path, as that stops the Stage to ask for approval.",
    "The Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.",
  ]);
}

/** The question the Stage's Agent asked the user last time, with the user's answer in words. */
export interface AnsweredQuestion {
  readonly question: string;
  readonly answer: string;
}

/** Why the Stage runs now, beside its brief; each is left out when it doesn't apply. */
export interface StageWorkReasons {
  /** The failure an on-failure loop, or a round the user gave, went back with. */
  readonly carried?: CarriedFailure & { readonly stageName: string };
  /** The Agent's question the user answered, when the Stage runs again for it. */
  readonly answered?: AnsweredQuestion;
  /** Why the install before the Stage failed. */
  readonly installProblem?: string;
  /** How the Stage's last run was interrupted, when it runs again after it. */
  readonly held?: HeldRun;
}

/**
 * The Stage's last run, interrupted: held by the user, who resumed the Task, or ended by The Office
 * restarting, which the user answered by running it again, maybe in their own words.
 */
export interface HeldRun {
  readonly by: StageInterruption;
  /** The user's own words in their answer to run it again after a restart. */
  readonly guidance?: string;
}

/**
 * What the Stage asks now (spec §2.3): its brief; the user's answer when the Stage runs again
 * after its Agent's question; when an on-failure loop went back to it, the failure it went back
 * with; when the user held its last run, how, and so where its edits stand; and when the install
 * before it failed, why, as the Agent's commands may fail for it. A new session gets it after the
 * Brief, a continued one alone.
 */
export function agentStageWork(
  stage: Pick<AgentStage, "key" | "name" | "brief">,
  { carried, answered, installProblem, held }: StageWorkReasons = {},
): string {
  return sections([
    `## The Stage: ${stage.name}\n\n${stage.brief}`,
    held && heldSection(held),
    answered &&
      `## Your question, answered\n\nYou asked the user: ${answered.question}\n\nTheir answer: ${answered.answer}\n\nGo on with the Stage from there.`,
    carried && whyAgain(stage, carried),
    installProblem &&
      `## The install before this Stage

${installProblem}

Commands that need the dependencies may fail until it passes. If the Task's changes broke it, fix that first; The Office installs again before the next Stage.`,
  ]);
}

const HELD_SECTIONS: Readonly<Record<StageInterruption, string>> = {
  stop: `## Stopped by the user

The user stopped this Stage while it ran, and has resumed it. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.`,
  pause: `## Paused by the user

The user paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.`,
  restart: `## The Office restarted

The Office restarted while this Stage ran, which ended your session at once, and the user chose to run the Stage again. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.`,
};

function heldSection({ by, guidance }: HeldRun): string {
  const words = guidance === undefined ? "" : `\n\nThe user's words for it:\n\n${guidance}`;
  return `${HELD_SECTIONS[by]}${words}`;
}

/**
 * Why the Stage runs again: a later Stage's loop went back to it, or the user gave it one more
 * round itself; with what the user said to do differently, when they said it.
 */
function whyAgain(
  stage: Pick<AgentStage, "key">,
  carried: CarriedFailure & { readonly stageName: string },
): string {
  const why =
    carried.stageKey === stage.key
      ? `The user chose one more round of this Stage after:\n\n${carried.error}`
      : `"${carried.stageName}" failed after it, so the Pipeline went back here (round ${carried.round} of ${carried.rounds}):\n\n${carried.error}`;
  const guidance =
    carried.guidance === undefined
      ? ""
      : `\n\nThe user's guidance for this round:\n\n${carried.guidance}`;
  return `## Why this Stage runs again\n\n${why}${guidance}`;
}

function earlierResultWords({ stageName, kind, outcome }: EarlierResult): string {
  const name = `- ${stageName} (${STAGE_KIND_NAMES[kind]})`;
  const note =
    outcome.handoverNote === undefined ? "" : `\n  Handover note: ${outcome.handoverNote}`;
  switch (outcome.status) {
    case "done":
      return `${name}: done. ${outcome.summary}${note}`;
    case "needs-decision":
      return `${name}: asked the user "${outcome.question}"${note}`;
    case "failed":
      return `${name}: failed. ${outcome.error}${note}`;
  }
}

function attachmentsSection(lines: readonly string[]): string {
  if (lines.length === 0) return "## Attachments\n\nNone.";
  return `## Attachments\n\nRead one with read_attachment, by its id.\n\n${lines.join("\n")}`;
}

function sections(parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined).join("\n\n");
}
