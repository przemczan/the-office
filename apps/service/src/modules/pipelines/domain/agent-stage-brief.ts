import {
  flagField,
  promptTemplate,
  renderedPart,
  type PromptTexts,
  type PromptValues,
} from "../../prompt-templates/index.js";
import {
  EARLIER_STAGE_RESULT,
  STAGE_BRIEF,
  STAGE_HANDOVER,
  STAGE_HELD,
  STAGE_MESSAGE,
  STAGE_RUNS_AGAIN,
  STAGE_SENT_AGAIN,
} from "./agent-stage-brief-templates.js";
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
import { reportedMetIn } from "./definition-of-done-reports.js";
import { isResolveStage } from "./resolve-stages.js";
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
  "In this Thread you work Stages of a Task's Pipeline, in the Task's worktree. Each Stage comes as a message saying what it asks, after the Task's Brief when your session is new. Work it through, checking your work with run_project_command: it runs one of the Project's commands by its key, or a command line you may run, such as one test file, where the Project's commands run (in the Task's run environment when the Project has one), and answers with the exit code and a file with the whole output. Your own shell runs on this computer, outside the run environment, so run the Project's checks with run_project_command, never by hand in your shell, and don't write a .env or start a database to make them run there. The Brief names the commands you may run. The Office commits your work after each Stage: you never commit, push or switch branches. The Stage ends when your turn ends, with your result, so finish within the turn whatever work you need: your sub-agents run in the foreground and answer within it, and you wait in it for anything else, such as a background command's output, never ending the turn to wait. Stop the background commands you no longer need before you end it. End the Stage with your result: done, with a summary, the numbers of the Definition of Done statements the work meets, and your Handover note (where you are, what is left, what to watch); needs_decision, once you asked and wait for the answer; or failed, with the reason, when you can't finish it. A Definition of Done statement you can't verify where you work, however many rounds you get, such as a live check on the user's workstation, you report as out of reach with why, never as met. A statement reported met, by you or an earlier Stage, stays met: the Brief marks those Reported met so far. One your work no longer meets, such as a regression you found, you list as no longer met, which takes it back. When a choice is the user's to make, open a Decision with open_decision, asking every question you have in that one Decision; when your brief or your authority says to consult someone first, use consult. Either returns at once: then end the Stage with needs_decision and your Handover note, and the answer comes as your next message. Small issues you find along the way, such as a typo, a missing check or a broken test beside your change, fix within this Task and name them in your Handover note. An issue too big for this Task or outside its scope, don't fix: propose a Bug Task with propose_bug_task, end the Stage with needs_decision, and go on with your own work once the answer comes, whichever it is. Write a screenshot of each screen you changed into the screenshots folder the Brief names and list it in your result's screenshots: The Office attaches exactly those. Attach anything else the user should see with the Task, such as a report, with attach_file or attach_link. Attach a design the user is to approve before its Gate, as one self-contained .html file: the preview loads nothing from outside the file. When your work needs something the base branch has and the Task's branch doesn't, call update_branch rather than asking anyone: The Office commits your work so far and brings the branch up to date. The Task's commit message is the message of the one commit Publish lands the Task as: when your work changes what it should say, update it with write_commit_message.";

/** What an Agent is told in a Stage Thread, after their card's instructions. */
export const AGENT_STAGE_THREAD_INSTRUCTIONS = promptTemplate({
  key: "pipelines.stage-thread-instructions",
  domain: "pipelines",
  name: "Instructions of a Stage Thread",
  description:
    "What an Agent is told about working Stages in a Stage Thread, after the instructions on their Role card.",
  variables: {},
  text: AGENT_STAGE_INSTRUCTIONS,
});

/** The Task's commit message: the one written, or the default while none is (`written` false). */
export interface BriefCommitMessage {
  readonly text: string;
  readonly written: boolean;
}

/** The commit message the last Agent Stage before a Publish rechecks, and what it diffs against. */
export interface RecheckedCommitMessage extends BriefCommitMessage {
  /** The branch Publish lands the Task on. */
  readonly landsOn: string;
  /**
   * The revisions the Task's changes are counted from, as "What changed so far" counts them: the
   * base branch as its upstream has it, after the Initiative's branch for a Task of one.
   */
  readonly changesFrom: readonly string[];
}

/** The Task's record, as an Agent Stage's Brief has it. */
export interface BriefTask {
  readonly title: string;
  /** The Description, worded as a section by Work. */
  readonly descriptionSection: string;
  readonly plan: string;
  readonly definitionOfDone: readonly string[];
  /** The message of the one commit Publish lands the Task as, and whether it was written. */
  readonly commitMessage: BriefCommitMessage;
  /** Each of the Task's Attachments, as a line of the Brief. */
  readonly attachmentLines: readonly string[];
  /** The records the Task is linked to, worded as a section by Work; none when it has none. */
  readonly linkedRecordsSection: string | undefined;
  /** Who created the Task and who started or queued it, worded as a section by Work. */
  readonly whoAskedSection: string;
  /** The Task's Connected devices that are connected as the Stage starts, one line each. */
  readonly connectedDeviceLines: readonly string[];
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
  /** The notes the user chose where the walk goes on with, when none of the Stage's routes held. */
  readonly routeNotes?: string;
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
 * and who started or queued it, its Description, Plan, Definition of Done and commit message, where the session works, the earlier Stages' results
 * with their Handover notes, the diff so far, the records the Task is linked to, the Attachments,
 * the commands the Agent may run and the Hard switches it follows. Conversations adds the answered
 * Decisions; transcripts are never handed over.
 */
export function agentStageRecord(
  prompts: PromptTexts,
  { task, earlier, diffSummary, commands, hardSwitches }: AgentStageRecord,
): string {
  const met = new Set(reportedMetIn(earlier.map(({ outcome }) => outcome)));
  const initiativeBranch = task.initiativeBranch ?? "";
  const publishingTask = task.initiativeBranch !== undefined && task.publishingTask === true;
  return renderedPart(prompts, STAGE_BRIEF, {
    title: task.title,
    projectName: task.projectName,
    whoAskedSection: task.whoAskedSection,
    descriptionSection: task.descriptionSection,
    worktreePath: task.worktree.path,
    worktreeBranch: task.worktree.branch,
    screenshotsFolder: task.worktree.screenshotsFolder,
    baseBranch: task.baseBranch,
    inInitiative: task.initiativeBranch !== undefined && !publishingTask,
    publishingTask,
    initiativeBranch,
    publishingMode: publishingModeWords(task.publishingMode, initiativeBranch, task.baseBranch),
    bases: baseWords({
      project: { baseBranch: task.baseBranch },
      initiativeBranch: task.initiativeBranch,
    }),
    plan: task.plan,
    hasDefinitionOfDone: task.definitionOfDone.length > 0,
    definitionOfDone: task.definitionOfDone.map((statement, index) => ({
      number: String(index + 1),
      statement,
      reportedMet: flagField(met.has(index + 1)),
    })),
    commitMessageWritten: task.commitMessage.written,
    commitMessage: task.commitMessage.text,
    fence: fenceFor(task.commitMessage.text),
    earlierStages: earlier.map((result) => earlierResultWords(prompts, result)).join("\n"),
    hasDiffSummary: diffSummary !== undefined,
    diffSummary: diffSummary ?? "",
    hasLinkedRecords: task.linkedRecordsSection !== undefined,
    linkedRecordsSection: task.linkedRecordsSection ?? "",
    hasConnectedDevices: task.connectedDeviceLines.length > 0,
    connectedDevices: task.connectedDeviceLines,
    hasAttachments: task.attachmentLines.length > 0,
    attachments: task.attachmentLines,
    commands: commands.words,
    hardSwitches: hardSwitchesSection(prompts, hardSwitches),
  });
}

/** Backticks longer than any run of them inside `text`, to fence it with. */
function fenceFor(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(([run]) => run.length));
  return "`".repeat(longest + 1);
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
  /**
   * The Task's commit message as it is now, which the last Agent Stage before a Publish rechecks
   * (`isLastAgentStageBeforePublish`), with the branch the Task's diff is read against.
   */
  readonly commitMessage?: RecheckedCommitMessage;
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
 * restarting, after which it goes on by itself, or as the user answered after restarts in a row,
 * maybe in their own words.
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
  /**
   * Set when the user chose to move the held run's session to a Stand-in Engine rather than wait
   * for the reset (spec 5.4): the stand-in's name and who chose it.
   */
  readonly standInChosen?: { readonly engineName: string; readonly chosenBy: HoldingUser };
}

/**
 * What the Stage asks now (spec §2.3): its brief; the user's answer when the Stage runs again after
 * its Agent's question; the Stages after it in the Pipeline; for the last Agent Stage before a
 * Publish, to recheck the commit message; when an on-failure loop went back to
 * it, the failure it went back with; when the user sent the work back to it from a Gate, their
 * feedback; when the user held its last run, how, and so where its edits stand; and when the
 * install before it failed, why, as the Agent's commands may fail for it. A new session gets it
 * after the Brief, a continued one alone.
 */
export function agentStageWork(
  prompts: PromptTexts,
  stage: Pick<AgentStage, "key" | "name" | "brief">,
  {
    carried,
    sentBack,
    answered,
    installProblem,
    held,
    pipeline,
    commitMessage,
  }: StageWorkReasons = {},
): string {
  const later = pipeline ? laterStages(stage, pipeline) : [];
  const recheck =
    pipeline && commitMessage && isLastAgentStageBeforePublish(stage, pipeline.stages)
      ? commitMessage
      : undefined;
  const [recheckBase = "", ...otherBases] = (recheck?.changesFrom ?? []).map(shortRevision);
  return renderedPart(prompts, STAGE_MESSAGE, {
    stageName: stage.name,
    stageBrief: stage.brief,
    listsLaterStages: pipeline !== undefined,
    hasLaterStages: later.length > 0,
    // A Script Stage's set command, such as the Project's tests or build: Publish runs none.
    fullCommandLater: later.some(({ commandLine }) => commandLine !== ""),
    laterStages: later,
    recheck: recheck !== undefined,
    landsOn: recheck?.landsOn ?? "",
    recheckBase: otherBases.length === 0 ? recheckBase : "",
    recheckBases: otherBases.length === 0 ? "" : [recheckBase, ...otherBases].join(" "),
    commitMessageWritten: recheck?.written ?? false,
    commitMessage: recheck?.text ?? "",
    fence: fenceFor(recheck?.text ?? ""),
    held: (held && heldSection(prompts, held)) ?? "",
    answered: answered !== undefined,
    question: answered?.question ?? "",
    answer: answered?.answer ?? "",
    runsAgain: carried ? whyAgain(prompts, stage, carried) : "",
    sentBack: sentBack !== undefined,
    gateName: sentBack?.gateName ?? "",
    feedback: sentBack?.feedback ?? "",
    installProblem: installProblem ?? "",
  });
}

/**
 * What the fresh session a Stage goes on in, within the same Stage run, once its session passed its
 * context limit (spec §2.5), is asked to do after its Brief: go on from the earlier session's
 * Handover note (or, with none, from the worktree's diff), then the Stage's work.
 */
export function restartedSessionWork(
  prompts: PromptTexts,
  { work, handoverNote }: { readonly work: string; readonly handoverNote: string | undefined },
): string {
  const handover = renderedPart(prompts, STAGE_HANDOVER, {
    hasHandoverNote: handoverNote !== undefined,
    handoverNote: handoverNote ?? "",
  });
  return `${handover}\n\n${work}`;
}

/**
 * Whether `stage` is the last Agent Stage before a Publish that lands the Task's commit message: a
 * Publish by the publishing mode comes later, with no Agent Stage of the Task's own between them.
 * The Resolve Stages The Office puts in are passed over, and are never it themselves; a branch-only
 * Publish lands no commit message.
 */
export function isLastAgentStageBeforePublish(
  stage: Pick<Stage, "key">,
  stages: readonly Stage[],
): boolean {
  if (isResolveStage(stage)) return false;
  const index = stages.findIndex(({ key }) => key === stage.key);
  if (index === -1) return false;
  for (const later of stages.slice(index + 1)) {
    if (isResolveStage(later)) continue;
    if (later.kind === "agent") return false;
    if (
      later.kind === "script" &&
      later.command === PUBLISH_COMMAND &&
      later.publishTarget !== "branch-only"
    ) {
      return true;
    }
  }
  return false;
}

/** A ref as git takes it for short: `refs/remotes/origin/main` as `origin/main`. */
function shortRevision(revision: string): string {
  return revision.replace(/^refs\/(?:remotes|heads)\//, "");
}

/** A later Stage as the Stage's message lists it. */
type LaterStage = PromptValues<typeof STAGE_MESSAGE.variables>["laterStages"][number];

/**
 * The Stages after `stage` in Pipeline order, as plain facts: what each runs, or who works it, so
 * the Agent can leave their work to them (spec §2.3).
 */
function laterStages(
  stage: Pick<Stage, "key">,
  { stages, commands, roleTitle }: StagePipeline,
): LaterStage[] {
  const later = stages.slice(stages.findIndex(({ key }) => key === stage.key) + 1);
  return later.map((laterStage) => {
    const agent = laterStage.kind === "agent" ? laterStage : undefined;
    const script =
      laterStage.kind === "script" && laterStage.command !== PUBLISH_COMMAND
        ? laterStage
        : undefined;
    const roleKey = agent && staffedRole(agent);
    const commandLine = script
      ? (commands.find(({ key }) => key === script.command)?.commandLine ?? "")
      : "";
    return {
      name: laterStage.name,
      kindName: STAGE_KIND_NAMES[laterStage.kind],
      agent: flagField(agent !== undefined),
      roleTitle: roleKey === undefined ? "" : roleTitle(roleKey),
      dutyLabel: agent?.duty === undefined ? "" : dutyLabel(agent.duty),
      // A brief's later lines stay within its item.
      brief: agent ? withinItem(agent.brief) : "",
      gate: flagField(laterStage.kind === "gate"),
      publish: flagField(laterStage.kind === "script" && script === undefined),
      commandLine,
      unsetCommand: script && commandLine === "" ? script.command : "",
      comesBack: flagField(
        laterStage.kind !== "gate" && laterStage.onFailure?.goBackTo === stage.key,
      ),
    };
  });
}

/** The section for a run held before, or undefined when it has nothing to say. */
function heldSection(
  prompts: PromptTexts,
  { by, byUser, notStarted, cutShort, guidance, refused, standInChosen }: HeldRun,
): string | undefined {
  const who = holdingUserWords(byUser);
  const byTheUser = by === "stop" || by === "pause";
  const standIn = !byTheUser && standInChosen !== undefined;
  const cutShortNow = cutShort === true && refused === undefined;
  const text = renderedPart(prompts, STAGE_HELD, {
    notStarted: notStarted === true,
    stop: by === "stop",
    pause: by === "pause",
    alarm: by === "alarm" && !standIn,
    usageWindow: by === "usage-window" && !standIn,
    standIn,
    restart: by === "restart" && !standIn,
    who,
    whoCapitalized: `${who.charAt(0).toUpperCase()}${who.slice(1)}`,
    engineName: standInChosen?.engineName ?? "",
    chosenBy: standInChosen ? holdingUserWords(standInChosen.chosenBy) : "",
    cutShortWhilePaused: cutShortNow && by === "pause",
    cutShortByAlarm: cutShortNow && by === "alarm",
    refused: refused !== undefined,
    ...refusedMessageValues(prompts, refused),
    hasGuidance: guidance !== undefined,
    guidance: guidance ?? "",
  });
  return text === "" ? undefined : text;
}

/**
 * What a Stage's session is sent on the Stand-in Engine it went on on, after its engine refused the
 * Stage's work for a used-up usage window (spec 5.4): the work again, as the session holds it.
 */
export function workSentAgain(
  prompts: PromptTexts,
  refused: NonNullable<HeldRun["refused"]>,
): string {
  return renderedPart(prompts, STAGE_SENT_AGAIN, refusedMessageValues(prompts, refused));
}

/**
 * The message the engine refused, sent again: the Stage's work, or the correction of its result.
 */
function refusedMessageValues(
  prompts: PromptTexts,
  refused: HeldRun["refused"],
): { readonly refusedWork: boolean; readonly correction: string } {
  if (refused === undefined || refused.message === "work") {
    return { refusedWork: true, correction: "" };
  }
  return { refusedWork: false, correction: correctionMessage(prompts, refused.problems ?? "") };
}

/**
 * Why the Stage runs again: a later Stage's loop went back to it, or the user, or the Consultant
 * asked first, gave it one more round itself; with what they said to do differently, when they said
 * it.
 */
function whyAgain(
  prompts: PromptTexts,
  stage: Pick<AgentStage, "key">,
  carried: CarriedRound,
): string {
  return renderedPart(prompts, STAGE_RUNS_AGAIN, {
    sameStage: carried.stageKey === stage.key,
    hasGuide: carried.guide !== undefined,
    guide: carried.guide ?? "",
    stageName: carried.stageName,
    round: String(carried.round),
    rounds: String(carried.rounds),
    error: carried.error,
    hasGuidance: carried.guidance !== undefined,
    guidance: carried.guidance ?? "",
  });
}

function earlierResultWords(prompts: PromptTexts, result: EarlierResult): string {
  return resultWords(prompts, result, result.outcome.handoverNote);
}

/** A Stage run's result as a line of a Brief, without its Handover note. */
export function stageResultWords(prompts: PromptTexts, result: EarlierResult): string {
  return resultWords(prompts, result, undefined);
}

function resultWords(
  prompts: PromptTexts,
  { stageName, kind, outcome, gateNotes, routeNotes }: EarlierResult,
  handoverNote: string | undefined,
): string {
  const gateContinued = gateNotes !== undefined;
  return renderedPart(prompts, EARLIER_STAGE_RESULT, {
    stageName,
    kindName: STAGE_KIND_NAMES[kind],
    gateContinued,
    gateNotes: withinItem(gateNotes ?? ""),
    done: !gateContinued && outcome.status === "done",
    summary: outcome.status === "done" ? outcome.summary : "",
    askedUser: !gateContinued && outcome.status === "needs-decision",
    question: outcome.status === "needs-decision" ? outcome.question : "",
    failed: !gateContinued && outcome.status === "failed",
    error: outcome.status === "failed" ? outcome.error : "",
    hasRouteNotes: routeNotes !== undefined,
    routeNotes: withinItem(routeNotes ?? ""),
    hasHandoverNote: handoverNote !== undefined,
    handoverNote: handoverNote ?? "",
  });
}

/** A later line of notes or a brief stays within its item. */
function withinItem(notes: string): string {
  return notes.replaceAll("\n", "\n  ");
}

/**
 * The runs that ended with a result, in the order given. A Gate's has none to brief with, but for
 * the notes the user let the work continue with, which every later Stage follows (spec §2.3).
 */
export function earlierResults(
  stages: readonly Stage[],
  runs: readonly StageRun[],
): EarlierResult[] {
  return runs.flatMap((run): EarlierResult[] => {
    const { stageKey, outcome, gateAction } = run;
    const stage = stages.find(({ key }) => key === stageKey);
    if (!stage || !outcome) return [];
    const routeNotes = routeNotesOf(run);
    const noted = routeNotes === undefined ? {} : { routeNotes };
    const result = { stageName: stage.name, kind: stage.kind, outcome, ...noted };
    if (stage.kind !== "gate") return [result];
    const gateNotes = gateAction?.kind === "continue" ? gateAction.feedback : undefined;
    if (gateNotes === undefined && routeNotes === undefined) return [];
    return [gateNotes === undefined ? result : { ...result, gateNotes }];
  });
}

/** The notes the user answered the run's no-route-holds Decision with, if any. */
function routeNotesOf({ decisions }: StageRun): string | undefined {
  const answer = decisions.find(({ kind }) => kind === "no-route-holds")?.answer;
  return answer?.kind === "follow-route" ? answer.guidance : undefined;
}
