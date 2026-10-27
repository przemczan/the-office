import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Channel, Notification } from "@the-office/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { notificationQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { useEventStreamStatus } from "../../api/event-stream-provider.tsx";
import { DesktopChannel } from "./desktop-channel.ts";
import { useInAppChannel } from "./in-app-channel.tsx";
import type { NotificationChannel, ShownNotification } from "./notification-channel.ts";
import { aboutLine, personOf, targetOf, unreadCount } from "./notification-words.ts";
import { useUnreadBadge } from "./unread-badge.ts";

/**
 * "Service down" goes where spec 2.7's routing sends it, in-app and to the desktop: the web raises
 * it itself, since the service can't while the web has lost it.
 */
const SERVICE_DOWN_CHANNELS: readonly Channel[] = ["in-app", "desktop"];

export const SERVICE_DOWN: Notification = {
  id: "service-down",
  kind: "office.service-down",
  roleKey: null,
  line: "The Office lost its service and is reconnecting.",
  pointsTo: { kind: "office" },
  channels: [...SERVICE_DOWN_CHANNELS],
  raisedAt: new Date(0).toISOString(),
};

/**
 * Brings each Notification to its channels as it is raised, and takes it off them as it clears
 * (spec §2.7): to the desktop while the tab isn't focused and the desktop is routed and allowed,
 * otherwise as an in-app toast; the open ones count in the tab's title and favicon. Those open
 * when the page loads are counted, not shown again.
 */
export function useNotificationChannels(): void {
  const open = useQuery(notificationQueries.open()).data;
  const serviceDown = useEventStreamStatus() === "reconnecting";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const inApp = useInAppChannel();
  const [desktop] = useState(() => new DesktopChannel());
  const all = useMemo(
    () => (open === undefined ? undefined : serviceDown ? [...open, SERVICE_DOWN] : open),
    [open, serviceDown],
  );
  const shown = useRef<ReadonlySet<string> | undefined>(undefined);

  useEffect(() => {
    if (all === undefined) return;
    const ids = new Set(all.map(({ id }) => id));
    const before = shown.current;
    shown.current = ids;
    if (before === undefined) return;
    for (const notification of all) {
      if (before.has(notification.id)) continue;
      void shownNotification(notification, queryClient, (target) => void navigate(target)).then(
        (toShow) => channelFor(notification, inApp, desktop)?.show(toShow),
      );
    }
    for (const id of before) {
      if (ids.has(id)) continue;
      inApp.clear(id);
      desktop.clear(id);
    }
  }, [all, queryClient, navigate, inApp, desktop]);

  useUnreadBadge(unreadCount(all ?? []));
}

function channelFor(
  { channels }: Notification,
  inApp: NotificationChannel,
  desktop: DesktopChannel,
): NotificationChannel | undefined {
  if (channels.includes("desktop") && desktop.takesNow()) return desktop;
  return channels.includes("in-app") ? inApp : undefined;
}

/** The person, the line and what it is about, read from the queries the page already keeps. */
async function shownNotification(
  notification: Notification,
  queryClient: QueryClient,
  open: (target: ReturnType<typeof targetOf>) => void,
): Promise<ShownNotification> {
  const { pointsTo } = notification;
  const [roles, projects, task] = await Promise.all([
    queryClient.ensureQueryData(roleQueries.list()).catch(() => undefined),
    queryClient.ensureQueryData(projectQueries.list()).catch(() => undefined),
    pointsTo.kind === "office"
      ? undefined
      : queryClient.ensureQueryData(taskQueries.one(pointsTo.taskId)).catch(() => undefined),
  ]);
  return {
    id: notification.id,
    person: personOf(notification, roles),
    line: notification.line,
    about: aboutLine(task, projects),
    open: () => open(targetOf(pointsTo)),
  };
}

/** Where the channels run: inside the shell's ToastProvider, rendering nothing of its own. */
export function NotificationChannels(): null {
  useNotificationChannels();
  return null;
}
