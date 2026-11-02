import {
  channelsOf,
  levelsOf,
  WINDOW_NEARLY_USED_PERCENT,
  type Channel,
  type NotificationKind,
  type Routing,
} from "./notification-kinds.js";

/** What a Notification opens: the thing that waits or happened (spec §2.7). */
export type Pointer =
  | { readonly kind: "decision"; readonly decisionId: string; readonly taskId: string }
  | { readonly kind: "gate"; readonly taskId: string; readonly stageKey: string }
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  /**
   * The Office's own state, as Now and the status strip show it; an engine down names its engine,
   * so each engine's is raised, and handled, on its own.
   */
  | { readonly kind: "office"; readonly engineId?: string }
  /** Now, where Needs you and Since you left show what a Notification gathered. */
  | { readonly kind: "since-you-left" };

/**
 * A Notification that stands for others rather than for a kind (spec §2.7 Defaults): Outcomes
 * landing close together, collapsed into one, or the summary of what quiet hours held. Neither is a
 * kind in the tree, so neither is a row of the grid.
 */
export type GatheringKind = "collapsed-outcomes" | "quiet-hours-summary";

/**
 * A pointer to something that waits on the user or happened, sent to the channels its kind routes
 * to and cleared on every channel once the user handles that thing, never by reading it.
 */
export interface Notification {
  readonly id: string;
  readonly kind: NotificationKind | GatheringKind;
  /**
   * Who speaks, by their Role's key; undefined when The Office does, in the UI's own voice: a Task
   * with nobody on it, or an Office kind while no Office Manager is hired (spec §2.7 Defaults).
   */
  readonly roleKey: string | undefined;
  /** In the person's first person, or the UI's own voice when nobody speaks. */
  readonly line: string;
  readonly pointsTo: Pointer;
  /** Where its kind's routing sends it. */
  readonly channels: readonly Channel[];
  readonly raisedAt: Date;
  /**
   * The Notifications it stands for, when it gathers others; it is cleared once none of them is
   * open. Collapsed Outcomes also take their place in the list.
   */
  readonly gathers: readonly string[];
  /** The channels quiet hours hold it from, until their summary goes. */
  readonly held: readonly Channel[];
  /** When it went to the phone; undefined until it does. */
  readonly phonePushedAt: Date | undefined;
}

/** What a Notification says, before it has an id and a time. */
export interface NotificationDraft {
  readonly kind: NotificationKind;
  readonly roleKey: string | undefined;
  readonly line: string;
  readonly pointsTo: Pointer;
}

/** The draft raised now, to the channels the routing sends its kind to. */
export function notificationOf(
  draft: NotificationDraft,
  id: string,
  raisedAt: Date,
  routing: Routing,
): Notification {
  return {
    ...draft,
    id,
    channels: channelsOf(draft.kind, routing),
    raisedAt,
    gathers: [],
    held: [],
    phonePushedAt: undefined,
  };
}

/** A Decision waits on the user: its asker's question, or The Office's. */
export function decisionWaiting(decision: {
  readonly id: string;
  readonly taskId: string;
  readonly roleKey: string | undefined;
  readonly question: string;
}): NotificationDraft {
  return {
    kind: "needs-you.decision",
    roleKey: decision.roleKey,
    line: decision.roleKey ? `I need your answer: ${decision.question}` : decision.question,
    pointsTo: { kind: "decision", decisionId: decision.id, taskId: decision.taskId },
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
    pointsTo: { kind: "gate", taskId, stageKey: gate.key },
  };
}

export function taskDone(taskId: string, personRole: string | undefined): NotificationDraft {
  return taskOutcome("outcomes.task-done", taskId, personRole, "I finished the Task.", "Done.");
}

/** Why a Stage failed for good (spec §2.7 Defaults: a failed Task). */
export type Failure =
  | { readonly kind: "no-retries-left"; readonly stageName: string }
  | { readonly kind: "definition-of-done" };

export function taskFailed(
  taskId: string,
  personRole: string | undefined,
  failure: Failure,
): NotificationDraft {
  const [firstPerson, officeVoice] =
    failure.kind === "no-retries-left"
      ? [
          `${failure.stageName} failed and I have no retries left.`,
          `${failure.stageName} failed with no retries left.`,
        ]
      : [
          "I ran every Stage, but the Definition of Done isn't met.",
          "Every Stage ran, but the Definition of Done isn't met.",
        ];
  return taskOutcome("outcomes.task-failed", taskId, personRole, firstPerson, officeVoice);
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
    pointsTo: { kind: "task", taskId },
  };
}

/** Every Task of an Initiative is Done: from the CTO while one is hired, who shapes them. */
export function initiativeDone(initiativeId: string, cto: string | undefined): NotificationDraft {
  return {
    kind: "outcomes.initiative-done",
    roleKey: cto,
    line: cto
      ? "Our Initiative is done: every one of its Tasks is Done."
      : "The Initiative is done.",
    pointsTo: { kind: "initiative", initiativeId },
  };
}

/**
 * Office kinds come from the Office Manager, by their Role's key, or in the UI's own voice while
 * nobody fills the Role (spec §2.7 and its Defaults).
 */
export function windowNearlyUsed(
  percentUsed: number,
  officeManager: string | undefined,
): NotificationDraft {
  const percent = Math.round(percentUsed);
  return officeKind(
    "office.window.nearly-used",
    officeManager,
    `We've used ${percent}% of the 5-hour window.`,
    `${percent}% of the 5-hour window is used.`,
  );
}

export function windowReset(officeManager: string | undefined): NotificationDraft {
  return officeKind(
    "office.window.reset",
    officeManager,
    "The 5-hour window reset, so we have all of it again.",
    "The 5-hour window reset.",
  );
}

export function engineDown(
  engine: { readonly id: string; readonly name: string },
  reason: string,
  officeManager: string | undefined,
): NotificationDraft {
  return {
    ...officeKind(
      "office.down.engine",
      officeManager,
      `I can't reach ${engine.name}: ${reason}`,
      `${engine.name} is down: ${reason}`,
    ),
    pointsTo: { kind: "office", engineId: engine.id },
  };
}

function officeKind(
  kind: NotificationKind,
  officeManager: string | undefined,
  firstPerson: string,
  officeVoice: string,
): NotificationDraft {
  return {
    kind,
    roleKey: officeManager,
    line: officeManager ? firstPerson : officeVoice,
    pointsTo: { kind: "office" },
  };
}

/** How the 5-hour window moved between two readings, as Notifications tell it. */
export function windowMove(
  previousPercent: number,
  currentPercent: number,
): "nearly-used" | "reset" | undefined {
  if (currentPercent < previousPercent) return "reset";
  if (
    previousPercent < WINDOW_NEARLY_USED_PERCENT &&
    currentPercent >= WINDOW_NEARLY_USED_PERCENT
  ) {
    return "nearly-used";
  }
  return undefined;
}

/** What the user did, or what came about, that handles what some Notifications point to. */
export type Handling =
  /** Answering a Decision also handles the failure it was opened about. */
  | { readonly kind: "decision-answered"; readonly decisionId: string; readonly taskId: string }
  | { readonly kind: "gate-acted"; readonly taskId: string }
  | { readonly kind: "task-resumed"; readonly taskId: string }
  /** The user opened the Task, which is where its outcome is looked at. */
  | { readonly kind: "task-opened"; readonly taskId: string }
  /** The user opened the Initiative, where it shows as done. */
  | { readonly kind: "initiative-opened"; readonly initiativeId: string }
  /** The user opened Now, where the 5-hour window shows. */
  | { readonly kind: "now-opened" }
  | { readonly kind: "window-reset" }
  /** A turn came back from the engine, which therefore answers again. */
  | { readonly kind: "engine-answered"; readonly engineId: string };

export function handles(handling: Handling, { kind, pointsTo }: Notification): boolean {
  switch (handling.kind) {
    case "decision-answered":
      return (
        (pointsTo.kind === "decision" && pointsTo.decisionId === handling.decisionId) ||
        (kind === "outcomes.task-failed" && pointsAt(pointsTo, handling.taskId))
      );
    case "gate-acted":
      return pointsTo.kind === "gate" && pointsTo.taskId === handling.taskId;
    case "task-resumed":
      return kind === "outcomes.task-paused" && pointsAt(pointsTo, handling.taskId);
    case "task-opened":
      return pointsTo.kind === "task" && pointsTo.taskId === handling.taskId;
    case "initiative-opened":
      return pointsTo.kind === "initiative" && pointsTo.initiativeId === handling.initiativeId;
    case "now-opened":
      return levelsOf(kind).includes("office.window");
    case "window-reset":
      return kind === "office.window.nearly-used";
    case "engine-answered":
      return kind === "office.down.engine" && isAbout(pointsTo, handling.engineId);
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

/** An engine down raised before engines were named stands for any engine. */
function isAbout(pointsTo: Pointer, engineId: string): boolean {
  return pointsTo.kind === "office" && (pointsTo.engineId ?? engineId) === engineId;
}

function pointsAt(pointsTo: Pointer, taskId: string): boolean {
  return pointsTo.kind === "task" && pointsTo.taskId === taskId;
}
