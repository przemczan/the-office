import { useMemo } from "react";
import { PersonAvatar } from "../person-avatar.tsx";
import { useNotices } from "../toasts.tsx";
import type { NotificationChannel } from "./notification-channel.ts";
import { OFFICE_TITLE } from "./notification-words.ts";

/**
 * The in-app channel's toast: the person with their avatar, or The Office with none, then the line
 * and what it is about, which open what the Notification points to. The unread count in the title
 * and favicon, and the strip, are the channel's other parts.
 */
export function useInAppChannel(): NotificationChannel {
  const notices = useNotices();
  return useMemo(
    () => ({
      show: ({ id, person, line, about, open }) =>
        notices.show({
          key: id,
          title: (
            <span className="notice-person">
              {person && <PersonAvatar roleKey={person.roleKey} name={person.name} size="xs" />}
              {person?.name ?? OFFICE_TITLE}
            </span>
          ),
          description: (
            <button type="button" className="notice-open" onClick={open}>
              <span className="notice-line">{line}</span>
              {about && <span className="notice-about">{about}</span>}
            </button>
          ),
        }),
      clear: (id) => notices.dismiss(id),
    }),
    [notices],
  );
}
