import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Notification } from "@the-office/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { notificationQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { useEventStreamStatus } from "../../api/event-stream-provider.tsx";
import { DesktopChannel } from "./desktop-channel.ts";
import { useInAppChannel } from "./in-app-channel.tsx";
import type { NotificationChannel, ShownNotification } from "./notification-channel.ts";
import { aboutLine, personOf, serviceDown, targetOf, unreadCount } from "./notification-words.ts";
import { useUnreadBadge } from "./unread-badge.ts";

/**
 * Brings each Notification to its channels as it is raised, and takes it off them as it clears
 * (spec §2.7): to the desktop while the tab isn't focused and the desktop is routed and allowed,
 * otherwise as an in-app toast; the open ones count in the tab's title and favicon. Those open
 * when the page loads are counted, not shown again.
 */
export function useNotificationChannels(): void {
  const open = useQuery(notificationQueries.open()).data;
  const roles = useQuery(roleQueries.list()).data;
  const routing = useQuery(notificationQueries.routing()).data;
  const reconnecting = useEventStreamStatus() === "reconnecting";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const inApp = useInAppChannel();
  const [desktop] = useState(() => new DesktopChannel());
  const all = useMemo(
    () =>
      open === undefined ? undefined : reconnecting ? [...open, serviceDown(roles, routing)] : open,
    [open, reconnecting, roles, routing],
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

/**
 * The browser's channel for it, if any; the phone is the service's to push to. Inside quiet hours
 * the desktop is held and the toast shows instead.
 */
function channelFor(
  { channels, held }: Notification,
  inApp: NotificationChannel,
  desktop: DesktopChannel,
): NotificationChannel | undefined {
  if (channels.includes("desktop") && !held.includes("desktop") && desktop.takesNow()) {
    return desktop;
  }
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
    "taskId" in pointsTo
      ? queryClient.ensureQueryData(taskQueries.one(pointsTo.taskId)).catch(() => undefined)
      : undefined,
  ]);
  return {
    id: notification.id,
    person: personOf(notification, roles),
    line: notification.line,
    about: aboutLine(task, projects),
    open: () => open(targetOf(notification)),
  };
}

/** Where the channels run: inside the shell's ToastProvider, rendering nothing of its own. */
export function NotificationChannels(): null {
  useNotificationChannels();
  return null;
}
