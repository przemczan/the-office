import type { AllowedCommands } from "./allowed-commands.js";
import { STAGE_KIND_NAMES, type AgentStage, type StageKind } from "./stage.js";
import type { CarriedFailure, StageOutcome } from "./stage-run.js";

/**
 * What an Agent does in a Stage Thread, after their card's instructions: the same for every Stage
 * of every Task, so it stays in the cached prefix.
 */
export const AGENT_STAGE_INSTRUCTIONS =
  "In this Thread you work Stages of a Task's Pipeline, in the Task's worktree. Each Stage comes as a message saying what it asks, after the Task's Brief when your session is new. Work it through, checking your work with the commands you may run, which the Brief names. The Office commits your work after each Stage: you never commit, push or switch branches. End the Stage with your result: done, with a summary and your Handover note (where you are, what is left, what to watch); needs_decision, when a choice is the user's to make, with the question, what they need to know, the options and the one you recommend; or failed, with the reason, when you can't finish it.";

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
      : `## The Definition of Done\n\n${task.definitionOfDone.map((statement) => `- ${statement}`).join("\n")}`,
    earlier.length === 0
      ? undefined
      : `## Earlier Stages\n\n${earlier.map(earlierResultWords).join("\n")}`,
    diffSummary === undefined ? undefined : `## What changed so far\n\n${diffSummary}`,
    attachmentsSection(task.attachmentLines),
    `## Commands you may run\n\n${commands.words}`,
  ]);
}

/**
 * What the Stage asks now (spec §2.3): its brief; when an on-failure loop went back to it, the
 * failure it went back with; and when the install before it failed, why, as the Agent's commands
 * may fail for it. A new session gets it after the Brief, a continued one alone.
 */
export function agentStageWork(
  stage: Pick<AgentStage, "name" | "brief">,
  carried: (CarriedFailure & { readonly stageName: string }) | undefined,
  installProblem?: string,
): string {
  return sections([
    `## The Stage: ${stage.name}\n\n${stage.brief}`,
    carried &&
      `## Why this Stage runs again\n\n"${carried.stageName}" failed after it, so the Pipeline went back here (round ${carried.round} of ${carried.rounds}):\n\n${carried.error}`,
    installProblem &&
      `## The install before this Stage

${installProblem}

Commands that need the dependencies may fail until it passes. If the Task's changes broke it, fix that first; The Office installs again before the next Stage.`,
  ]);
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
