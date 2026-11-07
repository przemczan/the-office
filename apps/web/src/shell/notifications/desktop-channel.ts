import type { NotificationChannel, ShownNotification } from "./notification-channel.ts";
import { OFFICE_TITLE } from "./notification-words.ts";

/** Whether this browser can show desktop Notifications, and what the user allowed. */
export type DesktopPermission = NotificationPermission | "unsupported";

export function desktopPermission(): DesktopPermission {
  return "Notification" in window ? Notification.permission : "unsupported";
}

/** Asks the browser once; after an answer the browser keeps it and asking again changes nothing. */
export async function askForDesktopPermission(): Promise<DesktopPermission> {
  if (desktopPermission() !== "default") return desktopPermission();
  return Notification.requestPermission();
}

/**
 * The desktop channel: the browser's Notification, shown only while the tab isn't focused (the
 * in-app toast shows otherwise). Clicking it brings the tab forward and opens what it points to.
 */
export class DesktopChannel implements NotificationChannel {
  private readonly shown = new Map<string, Notification>();

  /** Whether the desktop takes a Notification now, rather than the in-app toast. */
  takesNow(): boolean {
    return desktopPermission() === "granted" && !document.hasFocus();
  }

  show({ id, person, line, about, open }: ShownNotification): void {
    const notification = new Notification(person?.name ?? OFFICE_TITLE, {
      body: about ? `${line}\n${about}` : line,
      tag: id,
      icon: "/favicon.svg",
    });
    notification.addEventListener("click", () => {
      window.focus();
      open();
      notification.close();
    });
    notification.addEventListener("close", () => this.shown.delete(id));
    this.shown.set(id, notification);
  }

  clear(notificationId: string): void {
    this.shown.get(notificationId)?.close();
    this.shown.delete(notificationId);
  }
}
