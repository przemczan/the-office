import type { Notification, Pointer, Project, Role, Task } from "@the-office/contracts";

/** The product's name, the tab's title with no Notification open. */
export const OFFICE_TITLE = "The Office";

/** Where opening a Notification goes: the Task it is about, or Now for the Office's own state. */
export type NotificationTarget =
  | { readonly to: "/tasks/$taskId"; readonly params: { readonly taskId: string } }
  | { readonly to: "/now" };

export function targetOf(pointer: Pointer): NotificationTarget {
  return pointer.kind === "office"
    ? { to: "/now" }
    : { to: "/tasks/$taskId", params: { taskId: pointer.taskId } };
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
