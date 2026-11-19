import type { UserActivity } from "./user-activity.js";
import { CHANNELS, levelsOf, type Channel } from "./notification-kinds.js";
import type { Notification } from "./notification.js";
import { inQuietHours, minutesMs, type NotificationTiming } from "./notification-timing.js";

/**
 * The delivery rules (spec §2.7 and its Defaults): when a Notification reaches the desktop and the
 * phone. In-app is never held: quiet hours hold the desktop and the phone, the at-desk hold and the
 * away delay hold the phone, and Outcomes landing close together collapse into one.
 */

/** The channels outside the page, which quiet hours hold. */
const HELD_CHANNELS: readonly Channel[] = ["desktop", "phone"];

/** "The service or an Agent engine down" goes through quiet hours. */
export function passesQuietHours({ kind }: Pick<Notification, "kind">): boolean {
  return levelsOf(kind).includes("office.down");
}

/** The Notification as raised at `at`: inside quiet hours, held from the desktop and the phone. */
export function withQuietHours(
  notification: Notification,
  timing: NotificationTiming,
  at: Date,
): Notification {
  if (!inQuietHours(timing.quietHours, at) || passesQuietHours(notification)) return notification;
  return {
    ...notification,
    held: notification.channels.filter((channel) => HELD_CHANNELS.includes(channel)),
  };
}

/** What the clock has reached: a Notification is delivered only once it has been raised. */
export function raisedBy(at: Date): (notification: Notification) => boolean {
  return ({ raisedAt }) => raisedAt.getTime() <= at.getTime();
}

/** The open Notifications as the list shows them: those collapsed Outcomes stand for leave it. */
export function shownOf(open: readonly Notification[]): Notification[] {
  const collapsed = new Set(
    open.filter(({ kind }) => kind === "collapsed-outcomes").flatMap(({ gathers }) => gathers),
  );
  return open.filter(({ id }) => !collapsed.has(id));
}

export function isOutcome({ kind }: Pick<Notification, "kind">): boolean {
  return kind === "collapsed-outcomes" || levelsOf(kind).includes("outcomes");
}

/**
 * The shown Outcome a new one at `at` joins: the latest landing within the batching window before
 * it. Needs you is never batched.
 */
export function outcomeToJoin(
  shown: readonly Notification[],
  timing: NotificationTiming,
  at: Date,
): Notification | undefined {
  const windowMs = minutesMs(timing.batchOutcomesMinutes);
  return shown
    .filter((notification) => {
      const sinceMs = at.getTime() - notification.raisedAt.getTime();
      return isOutcome(notification) && sinceMs >= 0 && sinceMs < windowMs;
    })
    .toSorted((one, other) => other.raisedAt.getTime() - one.raisedAt.getTime())[0];
}

/** The Outcomes what joins stands for, still open: itself, or what it collapsed. */
export function outcomesOf(joined: Notification, open: readonly Notification[]): Notification[] {
  if (joined.kind !== "collapsed-outcomes") return [joined];
  return open.filter(({ id }) => joined.gathers.includes(id));
}

/**
 * Outcomes collapsed into one, in the UI's voice ("3 Tasks done"), opening Since you left and sent
 * where any of them goes.
 */
export function collapsedOutcomes(
  outcomes: readonly Notification[],
  id: string,
  at: Date,
): Notification {
  return gathering(
    "collapsed-outcomes",
    idsOf(outcomes),
    outcomesLine(outcomes),
    id,
    at,
    channelsOfAll(outcomes, "channels"),
  );
}

/**
 * The one summary when quiet hours end, of the shown Notifications they held, sent where those were
 * held from; undefined when they held nothing still open.
 */
export function quietHoursSummary(
  open: readonly Notification[],
  id: string,
  at: Date,
): Notification | undefined {
  const heldOnes = shownOf(open).filter(isHeld);
  if (heldOnes.length === 0) return undefined;
  const members = heldOnes.flatMap((notification) => outcomesOf(notification, open));
  return gathering(
    "quiet-hours-summary",
    idsOf(members),
    summaryLine(members),
    id,
    at,
    channelsOfAll(heldOnes, "held"),
  );
}

/** Whether quiet hours hold it from some channel, until their summary. */
export function isHeld({ held }: Pick<Notification, "held">): boolean {
  return held.length > 0;
}

/** The gathering Notifications none of whose members is open any more: they clear too. */
export function emptiedGatherings(open: readonly Notification[]): Notification[] {
  const openIds = new Set(open.map(({ id }) => id));
  return open.filter(
    ({ gathers }) => gathers.length > 0 && !gathers.some((member) => openIds.has(member)),
  );
}

/** What happens next with a shown Notification and the phone. */
export type PhoneDelivery =
  | { readonly kind: "now" }
  | { readonly kind: "wait"; readonly until: Date }
  /** Quiet hours hold it, until their summary. */
  | { readonly kind: "held" }
  /** It doesn't go to the phone, or went already. */
  | { readonly kind: "none" };

/**
 * The phone at `at`: inside quiet hours it is held; while the user is at the desk it waits, and it
 * goes once the hold since their last activity and then the away delay have passed (the away delay
 * counts from when the hold ends, spec §2.7 Defaults). `activity` is the user active last's, so it
 * goes only once every user is away.
 */
export function phoneDeliveryOf(
  notification: Notification,
  timing: NotificationTiming,
  activity: UserActivity | undefined,
  at: Date,
): PhoneDelivery {
  const { channels, held, phonePushedAt } = notification;
  if (!channels.includes("phone") || held.includes("phone") || phonePushedAt)
    return { kind: "none" };
  if (inQuietHours(timing.quietHours, at) && !passesQuietHours(notification))
    return { kind: "held" };
  if (!activity) return { kind: "now" };
  const until = new Date(
    activity.lastActiveAt.getTime() + minutesMs(timing.holdPhoneMinutes + timing.awayMinutes),
  );
  return until.getTime() <= at.getTime() ? { kind: "now" } : { kind: "wait", until };
}

function gathering(
  kind: Notification["kind"],
  gathers: readonly string[],
  line: string,
  id: string,
  at: Date,
  channels: readonly Channel[],
): Notification {
  return {
    id,
    kind,
    roleKey: undefined,
    line,
    shortLine: undefined,
    at: undefined,
    pointsTo: { kind: "since-you-left" },
    channels,
    raisedAt: at,
    gathers,
    held: [],
    phonePushedAt: undefined,
  };
}

function idsOf(notifications: readonly Notification[]): string[] {
  return notifications.map((notification) => notification.id);
}

function channelsOfAll(
  notifications: readonly Notification[],
  field: "channels" | "held",
): Channel[] {
  return CHANNELS.filter((channel) => notifications.some((each) => each[field].includes(channel)));
}

/** Each kind of Outcome as counted: one and many. */
const OUTCOME_WORDS: readonly (readonly [Notification["kind"], string, string])[] = [
  ["outcomes.task-done", "Task done", "Tasks done"],
  ["outcomes.task-failed", "Task failed", "Tasks failed"],
  ["outcomes.task-paused", "Task paused", "Tasks paused"],
  ["outcomes.initiative-done", "Initiative done", "Initiatives done"],
];

/** "3 Tasks done", "2 Tasks done, 1 Task failed". */
export function outcomesLine(outcomes: readonly Pick<Notification, "kind">[]): string {
  return OUTCOME_WORDS.map(([kind, one, many]) => {
    const count = outcomes.filter((outcome) => outcome.kind === kind).length;
    return count === 0 ? undefined : `${count} ${count === 1 ? one : many}`;
  })
    .filter((part) => part !== undefined)
    .join(", ");
}

/** "During quiet hours: 2 need you, 3 Outcomes, 1 from the Office." */
export function summaryLine(members: readonly Pick<Notification, "kind">[]): string {
  const count = (group: string): number =>
    members.filter(({ kind }) => levelsOf(kind).includes(group)).length;
  const [needsYou, outcomes, office] = [count("needs-you"), count("outcomes"), count("office")];
  const parts = [
    needsYou > 0 ? `${needsYou} ${needsYou === 1 ? "needs" : "need"} you` : undefined,
    outcomes > 0 ? `${outcomes} ${outcomes === 1 ? "Outcome" : "Outcomes"}` : undefined,
    office > 0 ? `${office} from the Office` : undefined,
  ].filter((part) => part !== undefined);
  return `During quiet hours: ${parts.join(", ")}.`;
}
