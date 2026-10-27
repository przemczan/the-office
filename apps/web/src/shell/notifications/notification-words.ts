import type { Channel, Notification, Project, Role, Task } from "@the-office/contracts";

/** The product's name, the tab's title with no Notification open. */
export const OFFICE_TITLE = "The Office";

/** The Role whose person the Office kinds come from once hired (spec §2.7). */
const OFFICE_MANAGER = "office-manager";

/**
 * Where opening a Notification goes: the Task it is about, or Now for the Office's own state, with
 * the Office Manager's chat over it when they speak.
 */
export type NotificationTarget =
  | { readonly to: "/tasks/$taskId"; readonly params: { readonly taskId: string } }
  | { readonly to: "/now"; readonly search?: { readonly chat: string } };

/**
 * An Office kind opens Now even when it opens the Office Manager's chat, since opening Now is what
 * handles the 5-hour window's (spec §2.7 Defaults).
 */
export function targetOf({
  pointsTo,
  roleKey,
}: Pick<Notification, "pointsTo" | "roleKey">): NotificationTarget {
  if (pointsTo.kind === "office") {
    return roleKey ? { to: "/now", search: { chat: roleKey } } : { to: "/now" };
  }
  return { to: "/tasks/$taskId", params: { taskId: pointsTo.taskId } };
}

/** Where spec 2.7's routing sends "service down": in-app and to the desktop. */
const SERVICE_DOWN_CHANNELS: readonly Channel[] = ["in-app", "desktop"];

/**
 * "Service down", which the web raises itself since the service can't while the web has lost it:
 * from the Office Manager while one is hired, as the service's Office kinds are.
 */
export function serviceDown(roles: readonly Role[] | undefined): Notification {
  const officeManager = roles?.find(({ key, letGoAt }) => key === OFFICE_MANAGER && !letGoAt);
  return {
    id: "service-down",
    kind: "office.service-down",
    roleKey: officeManager ? OFFICE_MANAGER : null,
    line: officeManager
      ? "I lost touch with the service and am reconnecting."
      : "The Office lost its service and is reconnecting.",
    pointsTo: { kind: "office" },
    channels: [...SERVICE_DOWN_CHANNELS],
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
