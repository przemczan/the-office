import type { Notification } from "@the-office/contracts";

/**
 * What The Office tells the user in the status strip's one slot: that the web lost the service,
 * one of its own Notifications, an Office update waiting to run, or the ask for desktop
 * Notifications.
 */
export type OfficeMessage =
  | { readonly kind: "reconnecting" }
  | { readonly kind: "notification"; readonly notification: Notification }
  | { readonly kind: "update-scheduled"; readonly waitingFor: number }
  | { readonly kind: "desktop-ask" };

export interface OfficeMessageSources {
  readonly reconnecting: boolean;
  /** Every open Notification, oldest first as they are listed; only the Office's own are messages. */
  readonly notifications: readonly Notification[];
  /** How many things a scheduled Office update waits for; undefined while none is scheduled. */
  readonly updateWaitingFor: number | undefined;
  /** The browser hasn't been asked for desktop Notifications yet. */
  readonly desktopAsk: boolean;
}

/** The slot's messages in the order it shows them: the first on the slot, "+more" for the rest. */
export interface OfficeMessageList {
  readonly all: readonly OfficeMessage[];
  readonly first: OfficeMessage;
  readonly more: number;
}

/**
 * Reconnecting first, then the Office's open Notifications newest first, then a scheduled update,
 * then the desktop ask; none when there is nothing to tell, and the slot is gone.
 */
export function officeMessages({
  reconnecting,
  notifications,
  updateWaitingFor,
  desktopAsk,
}: OfficeMessageSources): OfficeMessageList | undefined {
  const all: OfficeMessage[] = [
    ...(reconnecting ? [{ kind: "reconnecting" } as const] : []),
    ...notifications
      .filter(({ kind }) => kind.startsWith("office."))
      .toReversed()
      .map((notification) => ({ kind: "notification", notification }) as const),
    ...(updateWaitingFor === undefined
      ? []
      : [{ kind: "update-scheduled", waitingFor: updateWaitingFor } as const]),
    ...(desktopAsk ? [{ kind: "desktop-ask" } as const] : []),
  ];
  const [first] = all;
  return first && { all, first, more: all.length - 1 };
}

/** A message's tone, as every block's left edge has one: amber, red, green, blue or grey. */
export type OfficeMessageTone = "warning" | "danger" | "success" | "info" | "neutral";

export interface OfficeMessageWords {
  /** What the slot shows, at most about 34 characters. */
  readonly shortLine: string;
  /** What the list shows, whole. */
  readonly line: string;
  /** Under the short line where nobody speaks it; a Notification has who says it and when. */
  readonly detail: string | undefined;
  readonly tone: OfficeMessageTone;
  /** A Lucide icon's name, as `Icon` draws it. */
  readonly icon: string;
}

const NOTIFICATION_LOOKS: Readonly<
  Partial<Record<Notification["kind"], Pick<OfficeMessageWords, "tone" | "icon">>>
> = {
  "office.window.nearly-used": { tone: "warning", icon: "gauge" },
  "office.window.used-up": { tone: "danger", icon: "gauge" },
  "office.window.reset": { tone: "success", icon: "rotate-ccw" },
  "office.down.service": { tone: "danger", icon: "triangle-alert" },
  "office.down.engine": { tone: "danger", icon: "triangle-alert" },
  "office.alarm-lifted": { tone: "success", icon: "siren" },
  "office.update.done": { tone: "success", icon: "check" },
  "office.update.failed": { tone: "danger", icon: "triangle-alert" },
};

export function officeMessageWords(message: OfficeMessage): OfficeMessageWords {
  switch (message.kind) {
    case "reconnecting":
      return {
        shortLine: "Reconnecting to The Office…",
        line: "The web has lost the service and is reconnecting. The figures are the last ones read.",
        detail: "Figures may be out of date",
        tone: "warning",
        icon: "wifi-off",
      };
    case "notification": {
      const { kind, line, shortLine } = message.notification;
      const looks = NOTIFICATION_LOOKS[kind] ?? {
        tone: "neutral",
        icon: "bell",
      };
      // Raised before Notifications had a short line, it shows its whole line, cut to fit.
      return { shortLine: shortLine ?? line, line, detail: undefined, ...looks };
    }
    case "update-scheduled": {
      const things = message.waitingFor === 1 ? "1 thing" : `${message.waitingFor} things`;
      return {
        shortLine: "Update scheduled",
        line:
          message.waitingFor === 0
            ? "An Office update is scheduled."
            : `An Office update is scheduled, waiting for ${things} to finish.`,
        detail: message.waitingFor === 0 ? undefined : `Waiting for ${things}`,
        tone: "info",
        icon: "refresh-cw",
      };
    }
    case "desktop-ask":
      return {
        shortLine: "Turn on desktop notifications",
        line: "Desktop notifications need the browser's permission, asked once.",
        detail: "The browser asks once",
        tone: "neutral",
        icon: "bell",
      };
  }
}

/** A message's key among the others, stable while it shows. */
export function officeMessageKey(message: OfficeMessage): string {
  return message.kind === "notification" ? message.notification.id : message.kind;
}
