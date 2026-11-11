import type { Notification, Role } from "@the-office/contracts";
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useClosedFromOutside } from "../use-closed-from-outside.ts";
import { usePlacedList } from "../use-placed-list.ts";
import { personOf } from "./notification-words.ts";

/**
 * The Office's own Notifications in the status strip: only the newest shows, so a day's worth of
 * window resets never takes the whole strip, and the others open in a list from "+N more".
 * `notifications` comes oldest first, as the open Notifications are listed.
 */
export function OfficeNotificationsFigure({
  notifications,
  roles,
}: {
  readonly notifications: readonly Notification[];
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const newest = notifications.at(-1);
  if (!newest) return null;
  if (notifications.length === 1) {
    return (
      <span className="shell-strip-stat shell-strip-office">
        <OfficeNotificationLine notification={newest} roles={roles} />
      </span>
    );
  }
  return (
    <SeveralOfficeNotifications
      newest={newest}
      others={notifications.slice(0, -1).toReversed()}
      roles={roles}
    />
  );
}

function SeveralOfficeNotifications({
  newest,
  others,
  roles,
}: {
  readonly newest: Notification;
  readonly others: readonly Notification[];
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const anchor = useClosedFromOutside(open, setOpen, list);
  usePlacedList(open, anchor, list, "start");
  return (
    <div ref={anchor} className="shell-strip-stat shell-strip-office">
      <button
        type="button"
        className="shell-strip-office-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <OfficeNotificationLine notification={newest} roles={roles} />
        <span className="shell-strip-faint">+{others.length} more</span>
      </button>
      {open &&
        // On the page's body, as the strip clips what leaves it.
        createPortal(
          <div
            ref={list}
            role="dialog"
            aria-label="More Office Notifications"
            className="floating-menu shell-office-list"
          >
            <ul>
              {others.map((notification) => (
                <li key={notification.id}>
                  <OfficeNotificationLine notification={notification} roles={roles} />
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** The dot and the words, by the Office Manager's name once one speaks them. */
function OfficeNotificationLine({
  notification,
  roles,
}: {
  readonly notification: Notification;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const words = officeNotificationWords(notification, roles);
  return (
    <>
      <span className="shell-dot reconnecting" />
      <span className="shell-strip-office-line" title={words}>
        {words}
      </span>
    </>
  );
}

function officeNotificationWords(
  notification: Notification,
  roles: readonly Role[] | undefined,
): string {
  const person = personOf(notification, roles);
  return person ? `${person.name}: ${notification.line}` : notification.line;
}
