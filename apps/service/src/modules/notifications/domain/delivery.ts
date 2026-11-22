import type { UserActivity } from "./user-activity.js";
import { CHANNELS, levelsOf, type Channel } from "./notification-kinds.js";
import type { Delivery, Notification, ReceivedNotification } from "./notification.js";
import { inQuietHours, minutesMs, type NotificationTiming } from "./notification-timing.js";

/**
 * The delivery rules (spec §2.7 and its Defaults): when a Notification reaches each user's desktop
 * and phone, by that user's own routing, timing and activity. In-app is never held: quiet hours hold
 * the desktop and the phone, the at-desk hold and the away delay hold the phone, and Outcomes
 * landing close together collapse into one for the user.
 */

/** The channels outside the page, which quiet hours hold. */
const HELD_CHANNELS: readonly Channel[] = ["desktop", "phone"];

/** "The service or an Agent engine down" goes through quiet hours. */
export function passesQuietHours({ kind }: Pick<Notification, "kind">): boolean {
  return levelsOf(kind).includes("office.down");
}

/** The Notification as a user receives it on these channels, before any rule holds it. */
export function receivedOn(
  notification: Notification,
  channels: readonly Channel[],
): ReceivedNotification {
  return { ...notification, channels, held: [], phonePushedAt: undefined };
}

/**
 * The Notification as the user receives it raised at `at`: inside their quiet hours, held from the
 * desktop and the phone.
 */
export function withQuietHours(
  notification: ReceivedNotification,
  timing: NotificationTiming,
  at: Date,
): ReceivedNotification {
  if (!inQuietHours(timing.quietHours, at) || passesQuietHours(notification)) return notification;
  return {
    ...notification,
    held: notification.channels.filter((channel) => HELD_CHANNELS.includes(channel)),
  };
}

/** The user's delivery of what they receive. */
export function deliveryOf(
  { id, channels, held, phonePushedAt }: ReceivedNotification,
  userId: string,
): Delivery {
  return { notificationId: id, userId, channels, held, phonePushedAt };
}

/**
 * The open Notifications one user sees: the shared ones and their own, each with their delivery, or
 * on no channel when they have none.
 */
export function receivedBy(
  userId: string,
  open: readonly Notification[],
  deliveries: readonly Delivery[],
): ReceivedNotification[] {
  const byNotification = new Map(
    deliveries
      .filter((delivery) => delivery.userId === userId)
      .map((delivery) => [delivery.notificationId, delivery]),
  );
  return open
    .filter(({ forUser }) => forUser === undefined || forUser === userId)
    .map((notification) => {
      const delivery = byNotification.get(notification.id);
      return {
        ...notification,
        channels: delivery?.channels ?? [],
        held: delivery?.held ?? [],
        phonePushedAt: delivery?.phonePushedAt,
      };
    });
}

/** What the clock has reached: a Notification is delivered only once it has been raised. */
export function raisedBy(at: Date): (notification: Notification) => boolean {
  return ({ raisedAt }) => raisedAt.getTime() <= at.getTime();
}

/**
 * The open Notifications as one user's list shows them: those their collapsed Outcomes stand for
 * leave it.
 */
export function shownOf<Open extends Notification>(open: readonly Open[]): Open[] {
  const collapsed = new Set(
    open.filter(({ kind }) => kind === "collapsed-outcomes").flatMap(({ gathers }) => gathers),
  );
  return open.filter(({ id }) => !collapsed.has(id));
}

/**
 * An Outcome batching collapses: a test instance's is left out, as a collapse opens Since you left,
 * which lists no test instances (spec §2.7 Defaults, "Test instance Outcomes").
 */
export function isOutcome({ kind }: Pick<Notification, "kind">): boolean {
  if (kind === "collapsed-outcomes") return true;
  const levels = levelsOf(kind);
  return levels.includes("outcomes") && !levels.includes("outcomes.test-instance");
}

/**
 * The shown Outcome a new one at `at` joins: the latest landing within the batching window before
 * it. Needs you is never batched.
 */
export function outcomeToJoin<Shown extends Notification>(
  shown: readonly Shown[],
  timing: NotificationTiming,
  at: Date,
): Shown | undefined {
  const windowMs = minutesMs(timing.batchOutcomesMinutes);
  return shown
    .filter((notification) => {
      const sinceMs = at.getTime() - notification.raisedAt.getTime();
      return isOutcome(notification) && sinceMs >= 0 && sinceMs < windowMs;
    })
    .toSorted((one, other) => other.raisedAt.getTime() - one.raisedAt.getTime())[0];
}

/** The Outcomes what joins stands for, still open: itself, or what it collapsed. */
export function outcomesOf<Open extends Notification>(joined: Open, open: readonly Open[]): Open[] {
  if (joined.kind !== "collapsed-outcomes") return [joined];
  return open.filter(({ id }) => joined.gathers.includes(id));
}

/**
 * One user's Outcomes collapsed into one, in the UI's voice ("3 Tasks done"), opening Since you left
 * and sent where any of them goes for them.
 */
export function collapsedOutcomes(
  outcomes: readonly ReceivedNotification[],
  forUser: string,
  id: string,
  at: Date,
): ReceivedNotification {
  return receivedOn(
    gathering("collapsed-outcomes", idsOf(outcomes), outcomesLine(outcomes), forUser, id, at),
    channelsOfAll(outcomes, "channels"),
  );
}

/**
 * The one summary when a user's quiet hours end, of the shown Notifications they held from that
 * user, sent where those were held from; undefined when they held nothing still open.
 */
export function quietHoursSummary(
  open: readonly ReceivedNotification[],
  forUser: string,
  id: string,
  at: Date,
): ReceivedNotification | undefined {
  const heldOnes = shownOf(open).filter(isHeld);
  if (heldOnes.length === 0) return undefined;
  const members = heldOnes.flatMap((notification) => outcomesOf(notification, open));
  return receivedOn(
    gathering("quiet-hours-summary", idsOf(members), summaryLine(members), forUser, id, at),
    channelsOfAll(heldOnes, "held"),
  );
}

/** Whether quiet hours hold it from some channel, until their summary. */
export function isHeld({ held }: Pick<ReceivedNotification, "held">): boolean {
  return held.length > 0;
}

/** The gathering Notifications none of whose members is open any more: they clear too. */
export function emptiedGatherings<Open extends Notification>(open: readonly Open[]): Open[] {
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
 * A user's phone at `at`: inside their quiet hours it is held; while they are at the desk it waits,
 * and it goes once the hold since their last activity and then the away delay have passed (the away
 * delay counts from when the hold ends, spec §2.7 Defaults). `activity` is that user's own, so
 * another user at the desk holds nothing.
 */
export function phoneDeliveryOf(
  notification: ReceivedNotification,
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
  forUser: string,
  id: string,
  at: Date,
): Notification {
  return {
    id,
    kind,
    roleKey: undefined,
    line,
    shortLine: undefined,
    at: undefined,
    pointsTo: { kind: "since-you-left" },
    raisedAt: at,
    gathers,
    forUser,
  };
}

function idsOf(notifications: readonly Notification[]): string[] {
  return notifications.map((notification) => notification.id);
}

function channelsOfAll(
  notifications: readonly ReceivedNotification[],
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
