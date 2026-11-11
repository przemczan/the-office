import type { ThreadContext } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { CacheMark } from "../../shell/conversation/cache-mark.tsx";
import { PersonAvatar } from "../../shell/person-avatar.tsx";

/** A person's tab in a Task's or an Initiative's conversation: their avatar and first name. */
export function TabLabel({
  roleKey,
  name,
  working = false,
}: {
  readonly roleKey: string;
  readonly name: string;
  /** Their Stage runs now. */
  readonly working?: boolean;
}): ReactNode {
  return (
    <span className="conversation-tab">
      <PersonAvatar roleKey={roleKey} name={name} size="xs" />
      {name}
      {working && (
        <span className="live-dot" title={`${name}'s Stage runs now`}>
          <span className="visually-hidden">, working now</span>
        </span>
      )}
    </span>
  );
}

/** Another of the person's Threads to write in, as the To line offers them. */
export interface ToLineChoice {
  readonly threadId: string;
  readonly title: string;
}

/**
 * Over a tab's composer: whom the message goes to and the Thread it lands in. With more than one
 * Thread to choose from, the person shows over an unseen native list, which is what is pressed and
 * read out.
 */
export function ToLine({
  roleKey,
  personName,
  personLabel,
  place,
  context,
  choice,
}: {
  readonly roleKey: string;
  readonly personName: string;
  /** Their name and title. */
  readonly personLabel: string;
  /** The Thread's place, after the name; "this Thread" while it has no title. */
  readonly place?: string | null | undefined;
  /** The Thread's; a tab with no Thread has no cache to mark. */
  readonly context?: ThreadContext | undefined;
  readonly choice?:
    | {
        readonly threads: readonly ToLineChoice[];
        readonly chosenId: string;
        readonly onChoose: (threadId: string) => void;
      }
    | undefined;
}): ReactNode {
  const shown = (
    <span className="timeline-to-shown" aria-hidden={choice ? true : undefined}>
      <PersonAvatar roleKey={roleKey} name={personName} size="xs" />
      <strong>{personLabel}</strong>
      <span className="timeline-to-place">, in {place ?? "this Thread"}</span>
      {choice && <Icon name="chevron-down" size={12} />}
    </span>
  );
  return (
    <div className="timeline-to">
      <span aria-hidden="true">To</span>
      {context && <CacheMark context={context} />}
      {choice ? (
        <span className="timeline-to-pick">
          {shown}
          <select
            aria-label="To"
            value={choice.chosenId}
            onChange={(event) => choice.onChoose(event.target.value)}
          >
            {choice.threads.map(({ threadId, title }) => (
              <option key={threadId} value={threadId}>
                {title}
              </option>
            ))}
          </select>
        </span>
      ) : (
        shown
      )}
    </div>
  );
}
