import { baseWords, publishingModeWords } from "./base-words.js";
import type { AllowedCommands, NamedCommand } from "./allowed-commands.js";
import { hardSwitchesSection, type FollowedHardSwitches } from "./followed-hard-switches.js";
import { correctionMessage } from "./stage-result.js";
import { dutyLabel, staffedRole } from "./stage-staffing.js";
import {
  PUBLISH_COMMAND,
  STAGE_KIND_NAMES,
  type AgentStage,
  type Stage,
  type StageKind,
} from "./stage.js";
import { holdingUserWords } from "./stage-interruption.js";
import type {
  CarriedFailure,
  HoldingUser,
  RefusedTurn,
  SentBack,
  StageInterruption,
  StageOutcome,
  StageRun,
} from "./stage-run.js";

/**
 * What an Agent does in a Stage Thread, after their card's instructions: the same for every Stage
 * of every Task, so it stays in the cached prefix.
 */
export const AGENT_STAGE_INSTRUCTIONS =
  "In this Thread you work Stages of a Task's Pipeline, in the Task's worktree. Each Stage comes as a message saying what it asks, after the Task's Brief when your session is new. Work it through, checking your work with run_project_command: it runs one of the Project's commands by its key, or a command line you may run, such as one test file, where the Project's commands run (in the Task's run environment when the Project has one), and answers with the exit code and a file with the whole output. Your own shell runs on this computer, outside the run environment, so run the Project's checks with run_project_command, never by hand in your shell, and don't write a .env or start a database to make them run there. The Brief names the commands you may run. The Office commits your work after each Stage: you never commit, push or switch branches. The Stage ends when your turn ends, with your result, so finish within the turn whatever work you need: your sub-agents run in the foreground and answer within it, and you wait in it for anything else, such as a background command's output, never ending the turn to wait. Stop the background commands you no longer need before you end it. End the Stage with your result: done, with a summary, the numbers of the Definition of Done statements the work now meets, and your Handover note (where you are, what is left, what to watch); needs_decision, once you asked and wait for the answer; or failed, with the reason, when you can't finish it. A Definition of Done statement you can't verify where you work, however many rounds you get, such as a live check on the user's workstation, you report as out of reach with why, never as met. When a choice is the user's to make, open a Decision with open_decision; when your brief or your authority says to consult someone first, use consult. Either returns at once: then end the Stage with needs_decision and your Handover note, and the answer comes as your next message. Write a screenshot of each screen you changed into the screenshots folder the Brief names and list it in your result's screenshots: The Office attaches exactly those. Attach anything else the user should see with the Task, such as a report, with attach_file or attach_link. Attach a design the user is to approve before its Gate, as one self-contained .html file: the preview loads nothing from outside the file. When your work needs something the base branch has and the Task's branch doesn't, call update_branch rather than asking anyone: The Office commits your work so far and brings the branch up to date.";

/** The Task's record, as an Agent Stage's Brief has it. */
export interface BriefTask {
  readonly title: string;
  /** The Description, worded as a section by Work. */
  readonly descriptionSection: string;
  readonly plan: string;
  readonly definitionOfDone: readonly string[];
  /** Each of the Task's Attachments, as a line of the Brief. */
  readonly attachmentLines: readonly string[];
  /** The records the Task is linked to, worded as a section by Work; none when it has none. */
  readonly linkedRecordsSection: string | undefined;
  /** Who created the Task and who started or queued it, worded as a section by Work. */
  readonly whoAskedSection: string;
  readonly projectName: string;
  readonly baseBranch: string;
  /** The Initiative's branch the Task starts from and publishes into, when it has one. */
  readonly initiativeBranch?: string | undefined;
  /** Whether it is a Publishing Task, whose worktree holds the Initiative's branch itself. */
  readonly publishingTask?: boolean;
  /** The Project's publishing mode, which a Publishing Task's Publish follows. */
  readonly publishingMode?: "push-and-pull-request" | "merge";
  readonly worktree: {
    readonly path: string;
    readonly branch: string;
    /** Relative to the worktree. */
    readonly screenshotsFolder: string;
  };
}

/** A Stage run before this one, with how it ended. */
export interface EarlierResult {
  readonly stageName: string;
  readonly kind: StageKind;
  readonly outcome: StageOutcome;
  /** A Gate's run alone: the notes the user let the work continue with. */
  readonly gateNotes?: string;
}

/** What an Agent Stage's Brief is assembled from: the record, with no model call (spec §2.5). */
export interface AgentStageRecord {
  readonly task: BriefTask;
  /** In the order they ran. */
  readonly earlier: readonly EarlierResult[];
  /** What changed on the Task's branch so far; undefined when it isn't known. */
  readonly diffSummary: string | undefined;
  readonly commands: AllowedCommands;
  /** The Agent's followed Hard switches, from its Role card. */
  readonly hardSwitches: FollowedHardSwitches;
}

/**
 * The record a new session of an Agent Stage starts from (spec §2.5): the Task's title, who created
 * and who started or queued it, its Description, Plan and Definition of Done, where the session works, the earlier Stages' results
 * with their Handover notes, the diff so far, the records the Task is linked to, the Attachments,
 * the commands the Agent may run and the Hard switches it follows. Conversations adds the answered
 * Decisions; transcripts are never handed over.
 */
export function agentStageRecord({
  task,
  earlier,
  diffSummary,
  commands,
  hardSwitches,
}: AgentStageRecord): string {
  return sections([
    `## The Task\n\n${task.title}, in the Project ${task.projectName}.`,
    task.whoAskedSection,
    task.descriptionSection,
    `## Where you work\n\nThe Task's worktree, at ${task.worktree.path} on the branch ${task.worktree.branch}, ${startedFrom(task)}.\n\nScreenshots go in ${task.worktree.screenshotsFolder}/ there: git ignores it, and The Office keeps it as you leave it across test runs.`,
    task.plan === "" ? undefined : `## The Plan\n\n${task.plan}`,
    task.definitionOfDone.length === 0
      ? undefined
      : `## The Definition of Done\n\n${task.definitionOfDone.map((statement, index) => `${index + 1}. ${statement}`).join("\n")}`,
    earlier.length === 0
      ? undefined
      : `## Earlier Stages\n\n${earlier.map(earlierResultWords).join("\n")}`,
    diffSummary === undefined ? undefined : `## What changed so far\n\n${diffSummary}`,
    task.linkedRecordsSection,
    attachmentsSection(task.attachmentLines),
    `## Commands you may run\n\n${commands.words}`,
    // Claude Code asks approval for `cd <absolute path> && …` whatever the hook allows, which
    // fails an unattended Stage (task 12's check on the Test Project).
    "Run them in the worktree, where your session starts, with paths relative to it; never `cd` to an absolute path, as that stops the Stage to ask for approval.",
    "The Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.",
    hardSwitchesSection(hardSwitches),
  ]);
}

/** The question the Stage's Agent asked the user last time, with the user's answer in words. */
export interface AnsweredQuestion {
  readonly question: string;
  readonly answer: string;
}

/**
 * A carried failure as the Brief words it: with the failed Stage's name, and who gave the guidance,
 * such as "Bob (Architect)", when a Consultant did.
 */
export type CarriedRound = CarriedFailure & {
  readonly stageName: string;
  readonly guide?: string;
};

/** Why the Stage runs now, beside its brief; each is left out when it doesn't apply. */
export interface StageWorkReasons {
  /** The failure an on-failure loop, or a round the user or a Consultant gave, went back with. */
  readonly carried?: CarriedRound;
  /** The user's feedback from a Gate, when they sent the work back to this Stage. */
  readonly sentBack?: SentBack & { readonly gateName: string };
  /** The Agent's question the user answered, when the Stage runs again for it. */
  readonly answered?: AnsweredQuestion;
  /** Why the install before the Stage failed. */
  readonly installProblem?: string;
  /** How the Stage's last run was interrupted, when it runs again after it. */
  readonly held?: HeldRun;
  /** The Pipeline the Stage runs in, whose Stages after it the message lists. */
  readonly pipeline?: StagePipeline;
}

/** The Task's Pipeline as an Agent Stage's message words the Stages after its own. */
export interface StagePipeline {
  /** The Stages as the walk goes over them, the Stage itself among them. */
  readonly stages: readonly Stage[];
  /** The Project's commands, whose command lines a Script Stage runs. */
  readonly commands: readonly Pick<NamedCommand, "key" | "commandLine">[];
  /** The Role's title, such as Developer, by its key. */
  readonly roleTitle: (roleKey: string) => string;
}

/**
 * The Stage's last run, interrupted: held by the user, who resumed the Task, or ended by The Office
 * restarting, which the user answered by running it again, maybe in their own words.
 */
export interface HeldRun {
  readonly by: StageInterruption;
  /** The user whose Pause or Stop held it, when known. */
  readonly byUser?: HoldingUser;
  /** Set when The Office recorded it without starting it, having restarted between Stages. */
  readonly notStarted?: true;
  /**
   * Set when The Office cut the Agent's last turn short: of a paused run as it shut down, or of one
   * the fire alarm held, as it shut down or at the alarm's hard stop.
   */
  readonly cutShort?: true;
  /** The user's own words in their answer to run it again after a restart. */
  readonly guidance?: string;
  /**
   * Set when the engine refused the Agent's last turn for a used-up usage window: the message it
   * refused, which is sent again (spec 2.3).
   */
  readonly refused?: Pick<RefusedTurn, "message" | "problems">;
}

/**
 * What the Stage asks now (spec §2.3): its brief; the user's answer when the Stage runs again after
 * its Agent's question; the Stages after it in the Pipeline; when an on-failure loop went back to
 * it, the failure it went back with; when the user sent the work back to it from a Gate, their
 * feedback; when the user held its last run, how, and so where its edits stand; and when the
 * install before it failed, why, as the Agent's commands may fail for it. A new session gets it
 * after the Brief, a continued one alone.
 */
export function agentStageWork(
  stage: Pick<AgentStage, "key" | "name" | "brief">,
  { carried, sentBack, answered, installProblem, held, pipeline }: StageWorkReasons = {},
): string {
  return sections([
    `## The Stage: ${stage.name}\n\n${stage.brief}`,
    pipeline && laterStagesSection(stage, pipeline),
    held && heldSection(held),
    answered &&
      `## Your question, answered\n\nYou asked the user: ${answered.question}\n\nTheir answer: ${answered.answer}\n\nGo on with the Stage from there.`,
    carried && whyAgain(stage, carried),
    sentBack &&
      `## Sent back from ${sentBack.gateName}\n\nThe user looked at the work so far at the Gate and sent it back to this Stage with their feedback. It is no failure: act on it, then end the Stage with its result.\n\n${sentBack.feedback}`,
    installProblem &&
      `## The install before this Stage

${installProblem}

Commands that need the dependencies may fail until it passes. If the Task's changes broke it, fix that first; The Office installs again before the next Stage.`,
  ]);
}

/**
 * The Stages after `stage` in Pipeline order, as plain facts: what each runs, or who works it, so
 * the Agent can leave their work to them (spec §2.3).
 */
function laterStagesSection(stage: Pick<Stage, "key">, pipeline: StagePipeline): string {
  const later = pipeline.stages.slice(
    pipeline.stages.findIndex(({ key }) => key === stage.key) + 1,
  );
  if (later.length === 0) {
    return "## Later Stages\n\nNo Stage comes after this one in the Task's Pipeline.";
  }
  const lines = later.map((laterStage) => laterStageWords(laterStage, stage, pipeline));
  return `## Later Stages\n\nThese Stages come after this one in the Task's Pipeline, in order:\n\n${lines.join("\n")}`;
}

function laterStageWords(
  laterStage: Stage,
  stage: Pick<Stage, "key">,
  { commands, roleTitle }: StagePipeline,
): string {
  const kind = [
    STAGE_KIND_NAMES[laterStage.kind],
    ...(laterStage.kind === "agent" ? [workerWords(laterStage, roleTitle)] : []),
    ...(laterStage.optional ? ["optional"] : []),
  ].join(", ");
  const comesBack =
    laterStage.kind !== "gate" && laterStage.onFailure?.goBackTo === stage.key
      ? " If it fails, the work comes back here."
      : "";
  // A brief's later lines stay within its item.
  const what = laterStageDoes(laterStage, commands).replaceAll("\n", "\n  ");
  return `- ${laterStage.name} (${kind}): ${what}${comesBack}`;
}

/** Who works a later Agent Stage: its Role's title, or the duty nobody holds yet. */
function workerWords(stage: AgentStage, roleTitle: StagePipeline["roleTitle"]): string {
  const roleKey = staffedRole(stage);
  if (roleKey !== undefined) return roleTitle(roleKey);
  return stage.duty === undefined
    ? "nobody chosen yet"
    : `${dutyLabel(stage.duty)}, nobody holds it`;
}

function laterStageDoes(laterStage: Stage, commands: StagePipeline["commands"]): string {
  switch (laterStage.kind) {
    case "agent":
      return laterStage.brief;
    case "gate":
      return "the user looks at the work there and lets it continue or sends it back.";
    case "script": {
      if (laterStage.command === PUBLISH_COMMAND) return "The Office publishes the Task's work.";
      const commandLine = commands.find(({ key }) => key === laterStage.command)?.commandLine;
      return commandLine
        ? `runs \`${commandLine}\`.`
        : `runs the Project's command ${laterStage.command}, which isn't set.`;
    }
  }
}

/** The section for a run the user held, "the user Ann Lee" as `who` names them. */
const USER_HELD_SECTIONS: Readonly<Record<"stop" | "pause", (who: string) => string>> = {
  stop: (who) => `## Stopped by ${who}

${capitalized(who)} stopped this Stage while it ran, and has resumed it. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.`,
  pause: (who) => `## Paused by ${who}

${capitalized(who)} paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.`,
};

const HELD_SECTIONS: Readonly<Record<Exclude<StageInterruption, "stop" | "pause">, string>> = {
  alarm: `## Held by the fire alarm

The user sounded the fire alarm while this Stage ran, which held it after your last turn, and has given the all clear. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.`,
  "usage-window": `## Paused for the usage window

Your engine refused your last turn because a usage window of its account was used up, so The Office paused this Stage until the window reset, and has resumed it now. Your edits are in the worktree as you left them.`,
  restart: `## The Office restarted

The Office restarted while this Stage ran, which ended your session at once, and the user chose to run the Stage again. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.`,
};

/** What cut the Agent's last turn short: The Office restarting, or the fire alarm's hard stop. */
const CUT_SHORT: Readonly<Partial<Record<StageInterruption, string>>> = {
  pause:
    "The Office restarted during your last turn, which it cut short, so some of your edits may be half-done: check them before you go on.",
  alarm:
    "The Office cut your last turn short, so some of your edits may be half-done: check them before you go on.",
};

/**
 * A refused turn may have been cut off after some of its tool calls, as CUT_SHORT says of others.
 */
const REFUSED_HALF_DONE =
  "The engine may have refused your turn after some of its tool calls, so some of your edits may be half-done: check them before you go on.";

function heldSection({
  by,
  byUser,
  notStarted,
  cutShort,
  guidance,
  refused,
}: HeldRun): string | undefined {
  if (notStarted) {
    return guidance === undefined ? undefined : `## The user's words for this Stage\n\n${guidance}`;
  }
  const words = guidance === undefined ? "" : `\n\nThe user's words for it:\n\n${guidance}`;
  const cutWords = refused ? REFUSED_HALF_DONE : cutShort ? CUT_SHORT[by] : undefined;
  const cut = cutWords === undefined ? "" : `\n\n${cutWords}`;
  const resent = refused ? `\n\n${refusedMessageWords(refused)}` : "";
  const section =
    by === "stop" || by === "pause"
      ? USER_HELD_SECTIONS[by](holdingUserWords(byUser))
      : HELD_SECTIONS[by];
  return `${section}${cut}${resent}${words}`;
}

function capitalized(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/**
 * The message the engine refused, sent again: the Stage's work, or the correction of its result.
 */
function refusedMessageWords({ message, problems }: NonNullable<HeldRun["refused"]>): string {
  if (message === "work") {
    return "The message the engine refused was this Stage's work, above: do it now, and end with its result.";
  }
  return `The message the engine refused was The Office's request to correct your result, sent again:\n\n${correctionMessage(problems ?? "")}`;
}

/**
 * Why the Stage runs again: a later Stage's loop went back to it, or the user, or the Consultant
 * asked first, gave it one more round itself; with what they said to do differently, when they said
 * it.
 */
function whyAgain(stage: Pick<AgentStage, "key">, carried: CarriedRound): string {
  const chosen =
    carried.guide === undefined
      ? "The user chose one more round of this Stage"
      : `One more round of this Stage was chosen by ${carried.guide}`;
  const why =
    carried.stageKey === stage.key
      ? `${chosen} after:\n\n${carried.error}`
      : `"${carried.stageName}" failed after it, so the Pipeline went back here (round ${carried.round} of ${carried.rounds}):\n\n${carried.error}`;
  const heading =
    carried.guide === undefined
      ? "The user's guidance for this round"
      : `Guidance for this round from ${carried.guide}`;
  const guidance = carried.guidance === undefined ? "" : `\n\n${heading}:\n\n${carried.guidance}`;
  return `## Why this Stage runs again\n\n${why}${guidance}`;
}

function earlierResultWords(result: EarlierResult): string {
  const { handoverNote } = result.outcome;
  const note = handoverNote === undefined ? "" : `\n  Handover note: ${handoverNote}`;
  return `${stageResultWords(result)}${note}`;
}

/** A Stage run's result as a line of a Brief, without its Handover note. */
export function stageResultWords({ stageName, kind, outcome, gateNotes }: EarlierResult): string {
  const name = `- ${stageName} (${STAGE_KIND_NAMES[kind]})`;
  if (gateNotes !== undefined) {
    // A later brief line stays within its item, as laterStageWords keeps a brief's.
    const notes = gateNotes.replaceAll("\n", "\n  ");
    return `${name}: the user let the work continue, with notes for the Stages after it. Follow them:\n  ${notes}`;
  }
  switch (outcome.status) {
    case "done":
      return `${name}: done. ${outcome.summary}`;
    case "needs-decision":
      return `${name}: asked the user "${outcome.question}"`;
    case "failed":
      return `${name}: failed. ${outcome.error}`;
  }
}

/**
 * The runs that ended with a result, in the order given. A Gate's has none to brief with, but for
 * the notes the user let the work continue with, which every later Stage follows (spec §2.3).
 */
export function earlierResults(
  stages: readonly Stage[],
  runs: readonly StageRun[],
): EarlierResult[] {
  return runs.flatMap(({ stageKey, outcome, gateAction }): EarlierResult[] => {
    const stage = stages.find(({ key }) => key === stageKey);
    if (!stage || !outcome) return [];
    if (stage.kind !== "gate") return [{ stageName: stage.name, kind: stage.kind, outcome }];
    const gateNotes = gateAction?.kind === "continue" ? gateAction.feedback : undefined;
    if (gateNotes === undefined) return [];
    return [{ stageName: stage.name, kind: stage.kind, outcome, gateNotes }];
  });
}

function attachmentsSection(lines: readonly string[]): string {
  if (lines.length === 0) return "## Attachments\n\nNone.";
  return `## Attachments\n\nRead one with read_attachment, by its id: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase; an image as a picture where the engine shows one; any other file by its name, kind and size.\n\n${lines.join("\n")}`;
}

function sections(parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined).join("\n\n");
}

/**
 * What the Task's branch started from, and for a Task of an Initiative with a Pipeline where it
 * publishes and what it takes in (spec §2.3, "Publishing into an Initiative's branch"); a
 * Publishing Task's is the Initiative's branch itself ("A Publishing Task's Publish").
 */
function startedFrom(task: BriefTask): string {
  if (task.initiativeBranch === undefined) return `which started from ${task.baseBranch}`;
  if (task.publishingTask) {
    const mode = publishingModeWords(task.publishingMode, task.initiativeBranch, task.baseBranch);
    return `the Initiative's own. Its worktree holds ${task.initiativeBranch} itself, the Initiative's whole change in this Project; Publish puts it into ${task.baseBranch} by ${mode}. The Office brings ${task.baseBranch} into it`;
  }
  const bases = baseWords({
    project: { baseBranch: task.baseBranch },
    initiativeBranch: task.initiativeBranch,
  });
  return `which started from the Initiative's branch ${task.initiativeBranch}, and its Publish merges into ${task.initiativeBranch}, not ${task.baseBranch}. The Office brings ${bases} into it`;
}
