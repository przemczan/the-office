import type { StandInChoiceWaiting } from "./now.js";
import {
  levelsOf,
  WINDOW_NEARLY_USED_PERCENT,
  type Channel,
  type NotificationKind,
} from "./notification-kinds.js";

/** What a Notification opens: the thing that waits or happened (spec §2.7). */
export type Pointer =
  | { readonly kind: "decision"; readonly decisionId: string; readonly taskId: string }
  | { readonly kind: "gate"; readonly taskId: string; readonly stageKey: string }
  | { readonly kind: "task"; readonly taskId: string }
  /**
   * The Initiative page; for a Decision on no Task in one of its Threads, that Thread with the
   * Decision brought into view.
   */
  | {
      readonly kind: "initiative";
      readonly initiativeId: string;
      readonly decisionId?: string;
      readonly threadId?: string;
    }
  /**
   * The Office's own state, as Now and the status strip show it; an engine down names its engine,
   * so each engine's is raised, and handled, on its own.
   */
  | { readonly kind: "office"; readonly engineId?: string }
  /** Now, where Needs you and Since you left show what a Notification gathered. */
  | { readonly kind: "since-you-left" }
  /** Settings › Updates, with the last Office update's result and its log. */
  | { readonly kind: "office-update" }
  /** Now's Needs you, with the card of the Stages waiting for a Stand-in Engine. */
  | { readonly kind: "stand-in-choice" }
  /**
   * A test instance, in the Test instances fold of its Initiative's page, or of its Project's Test
   * targets when it is linked to none.
   */
  | {
      readonly kind: "test-instance";
      readonly instanceId: string;
      readonly projectId: string;
      readonly initiativeId?: string;
    };

/**
 * A Notification that stands for others rather than for a kind (spec §2.7 Defaults): Outcomes
 * landing close together, collapsed into one, or the summary of what quiet hours held. Neither is a
 * kind in the tree, so neither is a row of the grid.
 */
export type GatheringKind = "collapsed-outcomes" | "quiet-hours-summary";

/**
 * A pointer to something that waits on the user or happened, one fact shared by every user and
 * cleared for all of them once the user handles that thing, never by reading it. Each user receives
 * it on the channels their own routing gives it (`Delivery`).
 */
export interface Notification {
  readonly id: string;
  readonly kind: NotificationKind | GatheringKind;
  /**
   * Who speaks, by their Role's key; undefined when The Office does, in the UI's own voice: a Task
   * with nobody on it, or an Initiative done while nobody holds Shapes Initiatives (spec §2.7
   * Defaults).
   */
  readonly roleKey: string | undefined;
  /** In the person's first person, or the UI's own voice when nobody speaks. */
  readonly line: string;
  /**
   * The line cut to fit the status strip, in nobody's voice as the strip names who speaks beside
   * it; undefined for the kinds that have none, which the strip shows by `line`.
   */
  readonly shortLine: string | undefined;
  /**
   * The instant its line names, as a usage window's reset; its `line` and `shortLine` then hold
   * `{time}` where the time goes, which each channel words in its reader's time zone
   * (`withTimeWorded` for those outside the browser). Undefined when it names none.
   */
  readonly at: Date | undefined;
  readonly pointsTo: Pointer;
  readonly raisedAt: Date;
  /**
   * The Notifications it stands for, when it gathers others; it is cleared once none of them is
   * open. Collapsed Outcomes also take their place in its user's list.
   */
  readonly gathers: readonly string[];
  /**
   * The one user it is for, by id, when it gathers what their own batching or quiet hours held;
   * undefined for the shared Notifications every user sees.
   */
  readonly forUser: string | undefined;
}

/** How a Notification reaches one user: the channels their routing gives it, and what is held. */
export interface Delivery {
  readonly notificationId: string;
  readonly userId: string;
  /** Where the user's routing sends it; never empty, as a user with nothing routed has none. */
  readonly channels: readonly Channel[];
  /** The channels the user's quiet hours hold it from, until their summary goes. */
  readonly held: readonly Channel[];
  /** When it went to the user's phone; undefined until it does. */
  readonly phonePushedAt: Date | undefined;
}

/**
 * A Notification as one user receives it: with their delivery's channels, held and phone push, or
 * none of them when their routing gives it no channel.
 */
export interface ReceivedNotification extends Notification {
  readonly channels: readonly Channel[];
  readonly held: readonly Channel[];
  readonly phonePushedAt: Date | undefined;
}

/** What a Notification says, before it has an id and a time. */
export interface NotificationDraft {
  readonly kind: NotificationKind;
  readonly roleKey: string | undefined;
  readonly line: string;
  readonly shortLine: string | undefined;
  /** The instant its lines name at `{time}`; none for most kinds. */
  readonly at?: Date;
  readonly pointsTo: Pointer;
}

/** The draft raised now, shared by every user. */
export function notificationOf(draft: NotificationDraft, id: string, raisedAt: Date): Notification {
  return { ...draft, at: draft.at, id, raisedAt, gathers: [], forUser: undefined };
}

/** A Decision waits on the user: its asker's question, or The Office's. */
export function decisionWaiting(decision: {
  readonly id: string;
  readonly taskId: string;
  readonly roleKey: string | undefined;
  /** The Decision in one line: its first question, and how many more it asks. */
  readonly question: string;
}): NotificationDraft {
  return {
    kind: "needs-you.decision",
    roleKey: decision.roleKey,
    line: decision.roleKey ? `I need your answer: ${decision.question}` : decision.question,
    shortLine: undefined,
    pointsTo: { kind: "decision", decisionId: decision.id, taskId: decision.taskId },
  };
}

/**
 * A Decision on no Task waits on the user in one of an Initiative's Threads: its asker's question,
 * naming the Initiative, opening the Initiative's page at that Thread.
 */
export function decisionWaitingOnInitiative(decision: {
  readonly id: string;
  readonly threadId: string;
  readonly initiativeId: string;
  /** The Initiative's title, as the line names it. */
  readonly initiativeTitle: string;
  readonly roleKey: string | undefined;
  /** The Decision in one line: its first question, and how many more it asks. */
  readonly question: string;
}): NotificationDraft {
  const about = `On the Initiative ${decision.initiativeTitle}`;
  return {
    kind: "needs-you.decision",
    roleKey: decision.roleKey,
    line: decision.roleKey
      ? `${about}, I need your answer: ${decision.question}`
      : `${about}: ${decision.question}`,
    shortLine: undefined,
    pointsTo: {
      kind: "initiative",
      initiativeId: decision.initiativeId,
      decisionId: decision.id,
      threadId: decision.threadId,
    },
  };
}

/**
 * Stages paused by a used-up usage window wait for the user's choice of a Stand-in Engine (spec
 * 5.4): The Office's own Decision, one for them all, from `defaultPerson` as the Office kinds are.
 * It names the Stand-in Engine the first would move to now, or the one it was held asking while
 * none has room, and that Stage's reset at `{time}`.
 */
export function standInChoiceWaiting(
  waiting: readonly [StandInChoiceWaiting, ...StandInChoiceWaiting[]],
  defaultPerson: string | undefined,
): NotificationDraft {
  const [first] = waiting;
  const standIn = first.standInNow?.engineName ?? first.asked.engineName;
  const stages =
    waiting.length === 1 ? "1 paused Stage waits" : `${waiting.length} paused Stages wait`;
  return {
    kind: "needs-you.decision",
    roleKey: defaultPerson,
    line: `${stages} for your choice: switch to ${standIn}, or wait for the reset at ${TIME}.`,
    shortLine: undefined,
    at: new Date(first.resetsAt),
    pointsTo: { kind: "stand-in-choice" },
  };
}

/** The Task's person brought the work to a Gate. */
export function gateWaiting(
  taskId: string,
  gate: { readonly key: string; readonly name: string },
  personRole: string | undefined,
): NotificationDraft {
  return {
    kind: "needs-you.gate",
    roleKey: personRole,
    line: personRole
      ? `My work is ready for your look at ${gate.name}.`
      : `${gate.name} waits for your look.`,
    shortLine: undefined,
    pointsTo: { kind: "gate", taskId, stageKey: gate.key },
  };
}

export function taskDone(taskId: string, personRole: string | undefined): NotificationDraft {
  return taskOutcome("outcomes.task-done", taskId, personRole, "I finished the Task.", "Done.");
}

/**
 * Why a Stage failed for good (spec §2.7 Defaults: a failed Task): no failure route left, a route
 * at its limit (to `toName`, or End when undefined), or the Definition of Done not met.
 */
export type Failure =
  | { readonly kind: "no-retries-left"; readonly stageName: string }
  | { readonly kind: "route-limit"; readonly stageName: string; readonly toName?: string }
  | { readonly kind: "definition-of-done" };

export function taskFailed(
  taskId: string,
  personRole: string | undefined,
  failure: Failure,
): NotificationDraft {
  const [firstPerson, officeVoice] = failureWords(failure);
  return taskOutcome("outcomes.task-failed", taskId, personRole, firstPerson, officeVoice);
}

/** A failure in the person's own words and in The Office's. */
function failureWords(failure: Failure): readonly [string, string] {
  switch (failure.kind) {
    case "no-retries-left":
      return [
        `${failure.stageName} failed and I have no retries left.`,
        `${failure.stageName} failed with no retries left.`,
      ];
    case "route-limit": {
      const route = `${failure.stageName}'s route to ${failure.toName ?? "End"}`;
      return [`${route} reached its limit, so I stopped.`, `${route} reached its limit.`];
    }
    case "definition-of-done":
      return [
        "I ran every Stage, but the Definition of Done isn't met.",
        "Every Stage ran, but the Definition of Done isn't met.",
      ];
  }
}

/** Held by Pause, or by Stop, which keeps the work as Pause does but ends the running step. */
export function taskPaused(
  taskId: string,
  personRole: string | undefined,
  how: "pause" | "stop",
): NotificationDraft {
  return how === "pause"
    ? taskOutcome(
        "outcomes.task-paused",
        taskId,
        personRole,
        "I paused at a safe point.",
        "Paused.",
      )
    : taskOutcome("outcomes.task-paused", taskId, personRole, "I stopped where I was.", "Stopped.");
}

/**
 * Paused by The Office as its engine refused a turn for a used-up usage window (spec 2.1): why,
 * and when it resumes by itself. `window` is the usage window as the user reads it.
 */
export function taskPausedByUsageWindow(
  taskId: string,
  personRole: string | undefined,
  { engineName, window, resetsAt }: UsedUpWindowWords,
): NotificationDraft {
  return {
    ...taskOutcome(
      "outcomes.task-paused",
      taskId,
      personRole,
      `I paused: ${engineName}'s ${window} is used up. I'll go on at ${TIME}.`,
      `Paused: ${engineName}'s ${window} is used up. Resumes at ${TIME}.`,
    ),
    at: resetsAt,
  };
}

/** A used-up usage window, worded: the engine's name, the window as the user reads it, its reset. */
export interface UsedUpWindowWords {
  readonly engineName: string;
  readonly window: string;
  readonly resetsAt: Date;
}

/**
 * Where a Notification's lines put the time it names (`at`): the browser words it in its own time
 * zone, and `withTimeWorded` in the service's for the channels outside the browser.
 */
export const TIME = "{time}";

/**
 * Its lines with the time they name worded in the service's time zone, for a channel that has no
 * browser to word it (the phone); unchanged when it names none.
 */
export function withTimeWorded<Worded extends Pick<Notification, "line" | "shortLine" | "at">>(
  notification: Worded,
  now: Date,
): Worded {
  const { at } = notification;
  if (at === undefined) return notification;
  const time = clockWords(at, now);
  return {
    ...notification,
    line: notification.line.replaceAll(TIME, time),
    shortLine: notification.shortLine?.replaceAll(TIME, time),
  };
}

/** "14:00" on the service's day, "Mon 17 Nov 14:00" on another. */
function clockWords(at: Date, now: Date): string {
  const time = at.toTimeString().slice(0, 5);
  if (at.toDateString() === now.toDateString()) return time;
  const day = at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `${day.replace(",", "")} ${time}`;
}

function taskOutcome(
  kind: NotificationKind,
  taskId: string,
  personRole: string | undefined,
  firstPerson: string,
  officeVoice: string,
): NotificationDraft {
  return {
    kind,
    roleKey: personRole,
    line: personRole ? firstPerson : officeVoice,
    shortLine: undefined,
    pointsTo: { kind: "task", taskId },
  };
}

/**
 * Every Task of an Initiative is Done: from whoever holds Shapes Initiatives, or in the UI's own
 * voice while nobody does.
 */
export function initiativeDone(
  initiativeId: string,
  shaper: string | undefined,
): NotificationDraft {
  return {
    kind: "outcomes.initiative-done",
    roleKey: shaper,
    line: shaper
      ? "Our Initiative is done: every one of its Tasks is Done."
      : "The Initiative is done.",
    shortLine: undefined,
    pointsTo: { kind: "initiative", initiativeId },
  };
}

/** The test instance a Notification is about, and where it runs. */
export interface TestInstanceWords {
  readonly instanceId: string;
  readonly projectId: string;
  /** Undefined when it is linked to no Initiative. */
  readonly initiativeId: string | undefined;
  /** Its Initiative's title; undefined when it is linked to none or the Initiative isn't known. */
  readonly initiativeTitle: string | undefined;
  readonly branch: string | undefined;
  readonly targetName: string;
}

/**
 * Test instance Outcomes are in the UI's own voice, as the user launched the instance themselves
 * (spec §2.7 Defaults, "Test instance Outcomes").
 */
export function testInstanceRunning(instance: TestInstanceWords): NotificationDraft {
  return testInstanceOutcome(
    "outcomes.test-instance.running",
    instance,
    `${instance.targetName} ${placeOf(instance)} is Running.`,
  );
}

export function testInstanceBuilt(
  instance: TestInstanceWords,
  files: readonly string[],
): NotificationDraft {
  const made = files.length > 0 ? `: ${files.join(", ")}.` : ".";
  return testInstanceOutcome(
    "outcomes.test-instance.built",
    instance,
    `${instance.targetName} ${placeOf(instance)} is Built${made}`,
  );
}

export function testInstanceFailed(instance: TestInstanceWords, reason: string): NotificationDraft {
  return testInstanceOutcome(
    "outcomes.test-instance.failed",
    instance,
    `${instance.targetName} ${placeOf(instance)} failed: ${reason}`,
  );
}

/** "in <Initiative>" for a linked instance, "on <branch>" otherwise. */
function placeOf({ initiativeTitle, branch }: TestInstanceWords): string {
  if (initiativeTitle !== undefined) return `in ${initiativeTitle}`;
  return branch === undefined ? "in its Initiative" : `on ${branch}`;
}

function testInstanceOutcome(
  kind: NotificationKind,
  { instanceId, projectId, initiativeId }: TestInstanceWords,
  line: string,
): NotificationDraft {
  return {
    kind,
    roleKey: undefined,
    line,
    shortLine: undefined,
    // No initiativeId field when unlinked: a pointer read back from storage has none either.
    pointsTo:
      initiativeId === undefined
        ? { kind: "test-instance", instanceId, projectId }
        : { kind: "test-instance", instanceId, projectId, initiativeId },
  };
}

/**
 * Office kinds come from `defaultPerson`, by their Role's key: whoever holds Default person to talk
 * to, or the Caretaker while nobody does (spec §2.7 and its Defaults); in the UI's own voice
 * without one.
 */
export function windowNearlyUsed(
  engine: NamedEngine,
  percentUsed: number,
  defaultPerson: string | undefined,
): NotificationDraft {
  const percent = Math.round(percentUsed);
  return engineKind(
    engine,
    "office.window.nearly-used",
    defaultPerson,
    `We've used ${percent}% of ${engine.name}'s 5-hour window.`,
    `${percent}% of ${engine.name}'s 5-hour window is used.`,
    `${engine.name}: ${percent}% of 5-hour window`,
  );
}

export function windowReset(
  engine: NamedEngine,
  defaultPerson: string | undefined,
): NotificationDraft {
  return engineKind(
    engine,
    "office.window.reset",
    defaultPerson,
    `${engine.name}'s 5-hour window reset, so we have all of it again.`,
    `${engine.name}'s 5-hour window reset.`,
    `${engine.name}'s window reset`,
  );
}

/** The engine refuses turns until the window's reset; Tasks on it pause and wait (spec 2.7). */
export function windowUsedUp(
  engine: NamedEngine,
  { window, resetsAt }: Pick<UsedUpWindowWords, "window" | "resetsAt">,
  defaultPerson: string | undefined,
): NotificationDraft {
  return {
    ...engineKind(
      engine,
      "office.window.used-up",
      defaultPerson,
      `${engine.name}'s ${window} is used up until ${TIME}. I've paused the Tasks on it, and the rest wait.`,
      `${engine.name}'s ${window} is used up until ${TIME}. Tasks on it are paused and wait.`,
      `${engine.name} used up until ${TIME}`,
    ),
    at: resetsAt,
  };
}

export function engineDown(
  engine: NamedEngine,
  reason: string,
  defaultPerson: string | undefined,
): NotificationDraft {
  return engineKind(
    engine,
    "office.down.engine",
    defaultPerson,
    `I can't reach ${engine.name}: ${reason}`,
    `${engine.name} is down: ${reason}`,
    `${engine.name} is down`,
  );
}

/** The launcher updated The Office to `to` (spec §5.1 Defaults, "Updating The Office"). */
export function officeUpdated(to: string, defaultPerson: string | undefined): NotificationDraft {
  return {
    ...officeKind(
      "office.update.done",
      defaultPerson,
      `I updated The Office to ${to}.`,
      `The Office updated to ${to}.`,
      `Updated to ${to}`,
    ),
    pointsTo: { kind: "office-update" },
  };
}

/** The launcher's update failed at `step` and went back to `from`; the log is in Settings › Updates. */
export function officeUpdateFailed(
  step: string,
  from: string,
  defaultPerson: string | undefined,
): NotificationDraft {
  return {
    ...officeKind(
      "office.update.failed",
      defaultPerson,
      `The Office's update failed at ${step}, so I took it back to ${from}. The log is in Settings › Updates.`,
      `The Office's update failed at ${step}; it is back on ${from}. The log is in Settings › Updates.`,
      `Update failed, back on ${from}`,
    ),
    pointsTo: { kind: "office-update" },
  };
}

interface NamedEngine {
  readonly id: string;
  readonly name: string;
}

/** An Office kind about one engine, kept and handled apart from every other engine's. */
function engineKind(
  engine: NamedEngine,
  kind: NotificationKind,
  defaultPerson: string | undefined,
  firstPerson: string,
  officeVoice: string,
  shortLine: string,
): NotificationDraft {
  return {
    ...officeKind(kind, defaultPerson, firstPerson, officeVoice, shortLine),
    pointsTo: { kind: "office", engineId: engine.id },
  };
}

function officeKind(
  kind: NotificationKind,
  defaultPerson: string | undefined,
  firstPerson: string,
  officeVoice: string,
  shortLine: string,
): NotificationDraft {
  return {
    kind,
    roleKey: defaultPerson,
    line: defaultPerson ? firstPerson : officeVoice,
    shortLine,
    pointsTo: { kind: "office" },
  };
}

/** A reading of an engine's 5-hour window: how much is used, and when it resets. */
export interface WindowReading {
  readonly percentUsed: number;
  /** Undefined while the window has not begun. */
  readonly resetsAt: Date | undefined;
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
/** How far two readings' reset times may differ by rounding and still name the same moment. */
const RESET_TOLERANCE_MS = 60 * 1000;

/**
 * How an engine's 5-hour window moved between two of its readings, as Notifications tell it. It
 * resets only once the previous reading's reset time came (`now`, The Office's clock), or the
 * current reading's window began at or after it; a lower reading before then is a reading that
 * dipped, neither a reset nor a crossing of nearly used.
 */
export function windowMove(
  previous: WindowReading,
  current: WindowReading,
  now: Date,
): "nearly-used" | "reset" | undefined {
  const reset = windowHasReset(previous, current, now);
  if (reset && current.percentUsed < previous.percentUsed) return "reset";
  // A new window starts from nothing; within one, a lower reading than the last says nothing new.
  const before = reset ? 0 : previous.percentUsed;
  if (before < WINDOW_NEARLY_USED_PERCENT && current.percentUsed >= WINDOW_NEARLY_USED_PERCENT) {
    return "nearly-used";
  }
  return undefined;
}

/** Whether the window of the previous reading ended before the current one. */
export function windowHasReset(
  previous: WindowReading,
  current: WindowReading,
  now: Date,
): boolean {
  if (previous.resetsAt === undefined) return false;
  if (now.getTime() >= previous.resetsAt.getTime()) return true;
  if (current.resetsAt === undefined) return false;
  const began = current.resetsAt.getTime() - FIVE_HOURS_MS;
  return began >= previous.resetsAt.getTime() - RESET_TOLERANCE_MS;
}

/** What the user did, or what came about, that handles what some Notifications point to. */
export type Handling =
  /**
   * Answering a Decision, or asking it again, handles it; answering one on a Task also handles the
   * failure it was opened about.
   */
  | {
      readonly kind: "decision-answered";
      readonly decisionId: string;
      readonly taskId: string | undefined;
    }
  /**
   * Dropping its Task, or ending its Initiative for one on no Task, closed the Decision, which no
   * longer waits on the user.
   */
  | { readonly kind: "decision-closed"; readonly decisionId: string }
  | { readonly kind: "gate-acted"; readonly taskId: string }
  | { readonly kind: "task-resumed"; readonly taskId: string }
  /** The user opened the Task, which is where its outcome is looked at. */
  | { readonly kind: "task-opened"; readonly taskId: string }
  /** The user opened the Initiative, where it shows as done, with its test instances. */
  | { readonly kind: "initiative-opened"; readonly initiativeId: string }
  /** The user opened the Project's Test targets, with its test instances. */
  | { readonly kind: "test-instances-opened"; readonly projectId: string }
  /** A test instance moved to another state, so what was told of the last one is stale. */
  | { readonly kind: "test-instance-moved"; readonly instanceId: string }
  /** The user opened Now, where the 5-hour window shows. */
  | { readonly kind: "now-opened" }
  | { readonly kind: "window-reset"; readonly engineId: string }
  /** The engine's used-up usage window reached its reset, or a refusal moved the reset on. */
  | { readonly kind: "used-up-window-reset"; readonly engineId: string }
  /** A turn came back from the engine, which therefore answers again. */
  | { readonly kind: "engine-answered"; readonly engineId: string }
  /** Settings › Engines removed the engine, so nothing about it is left to act on. */
  | { readonly kind: "engine-removed"; readonly engineId: string }
  /** The user opened Settings › Updates, or a newer update's result replaces the last one's. */
  | { readonly kind: "office-update-opened" }
  /** No Stage waits for the choice of a Stand-in Engine any longer: each was switched or left. */
  | { readonly kind: "stand-in-choices-made" };

export function handles(handling: Handling, { kind, pointsTo }: Notification): boolean {
  switch (handling.kind) {
    case "decision-answered":
      return (
        pointsToDecision(pointsTo, handling.decisionId) ||
        (handling.taskId !== undefined &&
          kind === "outcomes.task-failed" &&
          pointsAt(pointsTo, handling.taskId))
      );
    case "decision-closed":
      return pointsToDecision(pointsTo, handling.decisionId);
    case "gate-acted":
      return pointsTo.kind === "gate" && pointsTo.taskId === handling.taskId;
    case "task-resumed":
      return kind === "outcomes.task-paused" && pointsAt(pointsTo, handling.taskId);
    case "task-opened":
      return pointsTo.kind === "task" && pointsTo.taskId === handling.taskId;
    case "initiative-opened":
      // A Decision waiting in one of its Threads is handled only by its answer, never by a look.
      return (
        (pointsTo.kind === "initiative" &&
          pointsTo.initiativeId === handling.initiativeId &&
          pointsTo.decisionId === undefined) ||
        (pointsTo.kind === "test-instance" && pointsTo.initiativeId === handling.initiativeId)
      );
    case "test-instances-opened":
      // Only the page the Notification opens handles it: a linked instance's is its Initiative's.
      return (
        pointsTo.kind === "test-instance" &&
        pointsTo.projectId === handling.projectId &&
        pointsTo.initiativeId === undefined
      );
    case "test-instance-moved":
      return pointsTo.kind === "test-instance" && pointsTo.instanceId === handling.instanceId;
    case "now-opened":
      return levelsOf(kind).includes("office.window");
    case "window-reset":
      return kind === "office.window.nearly-used" && isAbout(pointsTo, handling.engineId);
    case "used-up-window-reset":
      return kind === "office.window.used-up" && isAbout(pointsTo, handling.engineId);
    case "engine-answered":
      return kind === "office.down.engine" && isAbout(pointsTo, handling.engineId);
    case "engine-removed":
      return pointsTo.kind === "office" && pointsTo.engineId === handling.engineId;
    case "office-update-opened":
      return pointsTo.kind === "office-update";
    case "stand-in-choices-made":
      return pointsTo.kind === "stand-in-choice";
  }
}

/** Whether a later Notification would point at what an open one does, so only one is kept. */
export function samePointer(
  one: Pick<Notification, "kind" | "pointsTo">,
  other: Pick<Notification, "kind" | "pointsTo">,
): boolean {
  // Compared field by field: a pointer read back from storage may list its fields in another order.
  const fields = Object.entries(one.pointsTo);
  const otherFields = new Map(Object.entries(other.pointsTo));
  return (
    one.kind === other.kind &&
    fields.length === otherFields.size &&
    fields.every(([field, value]) => otherFields.get(field) === value)
  );
}

/** An engine's Notification raised before engines were named stands for any engine. */
function isAbout(pointsTo: Pointer, engineId: string): boolean {
  return pointsTo.kind === "office" && (pointsTo.engineId ?? engineId) === engineId;
}

/** On a Task it points to the Decision; on no Task, to the Initiative's Thread it waits in. */
function pointsToDecision(pointsTo: Pointer, decisionId: string): boolean {
  return (
    (pointsTo.kind === "decision" || pointsTo.kind === "initiative") &&
    pointsTo.decisionId === decisionId
  );
}

function pointsAt(pointsTo: Pointer, taskId: string): boolean {
  return pointsTo.kind === "task" && pointsTo.taskId === taskId;
}
