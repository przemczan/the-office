import type {
  Channel,
  Notification,
  NotificationRouting,
  Project,
  Role,
  Task,
} from "@the-office/contracts";

/** The product's name, the tab's title with no Notification open. */
export const OFFICE_TITLE = "The Office";

/** The Role whose person the Office kinds come from once hired (spec §2.7). */
const OFFICE_MANAGER = "office-manager";

/**
 * Where opening a Notification goes: the Task or the Initiative it is about, or Now for the
 * Office's own state, with the Office Manager's chat over it when they speak.
 */
export type NotificationTarget =
  | { readonly to: "/tasks/$taskId"; readonly params: { readonly taskId: string } }
  | {
      readonly to: "/work/initiatives/$initiativeId";
      readonly params: { readonly initiativeId: string };
    }
  | { readonly to: "/now"; readonly search?: { readonly chat: string } };

/**
 * An Office kind opens Now even when it opens the Office Manager's chat, since opening Now is what
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
 * from the Office Manager while one is hired, as the service's Office kinds are; to the browser's
 * channels the user's routing last read gives it.
 */
export function serviceDown(
  roles: readonly Role[] | undefined,
  routing: NotificationRouting | undefined,
): Notification {
  const officeManager = roles?.find(({ key, letGoAt }) => key === OFFICE_MANAGER && !letGoAt);
  const routed = routing?.["office.down.service"];
  // Until the routing is read, ticket 20's default: in-app and the desktop.
  const channels = routed
    ? BROWSER_CHANNELS.filter((channel) => routed[channel].on)
    : BROWSER_CHANNELS;
  return {
    id: "service-down",
    kind: "office.down.service",
    roleKey: officeManager ? OFFICE_MANAGER : null,
    line: officeManager
      ? "I lost touch with the service and am reconnecting."
      : "The Office lost its service and is reconnecting.",
    pointsTo: { kind: "office" },
    channels: [...channels],
    // The service's down only while the web lost it, so its quiet hours can't hold this one.
    held: [],
    raisedAt: new Date(0).toISOString(),
  };
}

/** "(3) The Office" while Notifications are open, so a tab in the background shows them. */
export function titleWithUnread(unread: number): string {
  return unread === 0 ? OFFICE_TITLE : `(${unread}) ${OFFICE_TITLE}`;
}

/** The person who speaks, by name; undefined when The Office does (spec §2.7 Defaults). */
export function personOf(
  notification: Pick<Notification, "roleKey">,
  roles: readonly Role[] | undefined,
): string | undefined {
  return roles?.find(({ key }) => key === notification.roleKey)?.card.name;
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

/** The Notifications shown in the tab's title and favicon: those routed in-app. */
export function unreadCount(open: readonly Pick<Notification, "channels">[]): number {
  return open.filter(({ channels }) => channels.includes("in-app")).length;
}
