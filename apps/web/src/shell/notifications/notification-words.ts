import type {
  Channel,
  Duty,
  Notification,
  NotificationRouting,
  Project,
  Role,
  Task,
} from "@the-office/contracts";
import type { NotificationPerson } from "./notification-channel.ts";
import { needsYouWords } from "./now-words.ts";

/** The product's name: who speaks when no person does, and the tab's title while nothing waits. */
export const OFFICE_TITLE = "The Office";

/**
 * Where opening a Notification goes: the Task or the Initiative it is about, Settings › Updates for
 * an Office update, or Now for the Office's own state, with the chat of the person who speaks over
 * it.
 */
export type NotificationTarget =
  | { readonly to: "/tasks/$taskId"; readonly params: { readonly taskId: string } }
  | {
      readonly to: "/work/initiatives/$initiativeId";
      readonly params: { readonly initiativeId: string };
    }
  | { readonly to: "/now"; readonly search?: { readonly chat: string } }
  | { readonly to: "/settings/updates" };

/**
 * An Office kind opens Now even when it opens its speaker's chat, since opening Now is what
 * handles the 5-hour window's (spec §2.7 Defaults). What gathers others opens Now too, where Needs
 * you and Since you left show them.
 */
export function targetOf({
  pointsTo,
  roleKey,
}: Pick<Notification, "pointsTo" | "roleKey">): NotificationTarget {
  if (pointsTo.kind === "office") {
    return roleKey ? { to: "/now", search: { chat: roleKey } } : { to: "/now" };
  }
  if (pointsTo.kind === "since-you-left") return { to: "/now" };
  if (pointsTo.kind === "office-update") return { to: "/settings/updates" };
  if (pointsTo.kind === "initiative") {
    return {
      to: "/work/initiatives/$initiativeId",
      params: { initiativeId: pointsTo.initiativeId },
    };
  }
  return { to: "/tasks/$taskId", params: { taskId: pointsTo.taskId } };
}

/** The channels in the browser; the phone is pushed to by the service. */
const BROWSER_CHANNELS: readonly Channel[] = ["in-app", "desktop"];

/**
 * "Service down", which the web raises itself since the service can't while the web has lost it:
 * from whoever holds Default person to talk to, or the Caretaker while nobody does, as the
 * service's Office kinds are; to the browser's channels the user's routing last read gives it. It
 * runs while the service is out of reach, so it reads only what was read before, never fetching.
 */
export function serviceDown(
  duties: readonly Duty[] | undefined,
  roles: readonly Role[] | undefined,
  routing: NotificationRouting | undefined,
): Notification {
  const speaker = officeSpeaker(duties, roles);
  const routed = routing?.["office.down.service"];
  // Until the routing is read, ticket 20's default: in-app and the desktop.
  const channels = routed
    ? BROWSER_CHANNELS.filter((channel) => routed[channel].on)
    : BROWSER_CHANNELS;
  return {
    id: "service-down",
    kind: "office.down.service",
    roleKey: speaker ?? null,
    line: speaker
      ? "I lost touch with the service and am reconnecting."
      : "The Office lost its service and is reconnecting.",
    pointsTo: { kind: "office" },
    channels: [...channels],
    // The service's down only while the web lost it, so its quiet hours can't hold this one.
    held: [],
    raisedAt: new Date(0).toISOString(),
  };
}

/**
 * Who the Office kinds come from (spec §2.7): the holder of Default person to talk to, else the
 * Caretaker; undefined, so The Office speaks, until the duties and the Roles were read.
 */
function officeSpeaker(
  duties: readonly Duty[] | undefined,
  roles: readonly Role[] | undefined,
): string | undefined {
  const holding = duties?.find(({ key }) => key === "default-person-to-talk-to");
  if (!holding || !roles) return undefined;
  return holding.holder?.roleKey ?? roles.find(({ builtIn }) => builtIn)?.key;
}

/** "(3) The Office" while Needs you holds items, so a tab in the background shows them. */
export function tabTitle(needsYou: number): string {
  return needsYou === 0 ? OFFICE_TITLE : `(${needsYou}) ${OFFICE_TITLE}`;
}

/** "3 need you": the title a blinking tab alternates with its steady one. */
export function blinkingTabTitle(needsYou: number): string {
  return `${needsYou} ${needsYouWords(needsYou)}`;
}

/** The person who speaks; undefined when The Office does (spec §2.7 Defaults). */
export function personOf(
  notification: Pick<Notification, "roleKey">,
  roles: readonly Role[] | undefined,
): NotificationPerson | undefined {
  const role = roles?.find(({ key }) => key === notification.roleKey);
  return role && { roleKey: role.key, name: role.card.name };
}

/** "Add a filter · Billing": the Task and its Project, when the Notification is about a Task. */
export function aboutLine(
  task: Pick<Task, "title" | "projectId"> | undefined,
  projects: readonly Project[] | undefined,
): string | undefined {
  if (!task) return undefined;
  const project = projects?.find(({ id }) => id === task.projectId);
  return project ? `${task.title} · ${project.name}` : task.title;
}
