import { Link } from "@tanstack/react-router";
import type { Role } from "@the-office/contracts";
import { Button, Icon, Popover } from "@the-office/ui";
import type { ReactNode } from "react";
import { PersonAvatar } from "../person-avatar.tsx";
import { momentWords } from "../time.ts";
import { personOf } from "./notification-words.ts";
import {
  officeMessageKey,
  officeMessageWords,
  type OfficeMessage,
  type OfficeMessages as Messages,
} from "./office-messages.ts";

/**
 * The status strip's one slot for what The Office tells the user, of a fixed width at its right
 * end so a long message never moves a figure: the first message by its short line, with who says
 * it and when, and "+N" for the rest. A press lists them all, each whole with its action.
 */
export function OfficeMessages({
  messages,
  roles,
  onAskForDesktop,
}: {
  readonly messages: Messages;
  readonly roles: readonly Role[] | undefined;
  readonly onAskForDesktop: () => void;
}): ReactNode {
  const { all, first, more } = messages;
  const words = officeMessageWords(first);
  return (
    <Popover
      label={`Office Notifications: ${words.shortLine}${more > 0 ? `, ${more} more` : ""}`}
      triggerClassName={`shell-strip-slot tone-${words.tone}${first.kind === "reconnecting" ? " pulse" : ""}`}
      trigger={
        <>
          <span className="shell-strip-slot-icon">
            <Icon name={words.icon} size={16} />
          </span>
          <span className="shell-strip-slot-text">
            <span className="shell-strip-slot-short">{words.shortLine}</span>
            <MessageMeta message={first} roles={roles} />
          </span>
          <span className="shell-strip-slot-end">
            {more > 0 && <span className="shell-strip-slot-count">+{more}</span>}
            <Icon name="chevron-down" size={12} />
          </span>
        </>
      }
    >
      <div className="shell-office-messages">
        <p className="popover-head">
          Office Notifications <span className="shell-strip-faint">· {all.length}</span>
        </p>
        <ul>
          {all.map((message) => (
            <MessageItem
              key={officeMessageKey(message)}
              message={message}
              roles={roles}
              onAskForDesktop={onAskForDesktop}
            />
          ))}
        </ul>
      </div>
    </Popover>
  );
}

function MessageItem({
  message,
  roles,
  onAskForDesktop,
}: {
  readonly message: OfficeMessage;
  readonly roles: readonly Role[] | undefined;
  readonly onAskForDesktop: () => void;
}): ReactNode {
  const { line, tone, icon } = officeMessageWords(message);
  return (
    <li className={`tone-${tone}`}>
      <span className="shell-strip-slot-icon">
        <Icon name={icon} size={16} />
      </span>
      <div>
        <p>{line}</p>
        <MessageMeta message={message} roles={roles} />
        <MessageAction message={message} onAskForDesktop={onAskForDesktop} />
      </div>
    </li>
  );
}

/** Who says it and when, "Pam · 13:05", or the time alone while nobody is the Office Manager. */
function MessageMeta({
  message,
  roles,
}: {
  readonly message: OfficeMessage;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  if (message.kind !== "notification") {
    const { detail } = officeMessageWords(message);
    return detail && <span className="shell-strip-slot-meta">{detail}</span>;
  }
  const person = personOf(message.notification, roles);
  const at = momentWords(message.notification.raisedAt);
  return (
    <span className="shell-strip-slot-meta">
      {person && (
        <>
          <PersonAvatar roleKey={person.roleKey} name={person.name} size="xs" />
          {person.name} ·{" "}
        </>
      )}
      {at}
    </span>
  );
}

function MessageAction({
  message,
  onAskForDesktop,
}: {
  readonly message: OfficeMessage;
  readonly onAskForDesktop: () => void;
}): ReactNode {
  const opensUpdates =
    message.kind === "update-scheduled" ||
    (message.kind === "notification" && message.notification.pointsTo.kind === "office-update");
  if (opensUpdates) {
    return (
      <p className="shell-office-message-action">
        <Link to="/settings/updates">Open Settings › Updates</Link>
      </p>
    );
  }
  if (message.kind === "desktop-ask") {
    return (
      <p className="shell-office-message-action">
        <Button size="sm" onClick={onAskForDesktop}>
          Turn on desktop notifications
        </Button>
      </p>
    );
  }
  return null;
}
