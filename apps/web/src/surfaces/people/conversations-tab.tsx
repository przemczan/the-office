import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { Thread } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { useChat } from "../../shell/chat/use-chat.ts";
import { contextLabel, tokensShort } from "../../shell/conversation/context-words.ts";
import { dayAndClockOf } from "../../shell/time.ts";
import { PersonBlock } from "./role-card-layout.tsx";

/**
 * The person's chat Threads, each opening in the chat (prototypes/app/people.js); Threads on Tasks
 * and Consultations come with Tasks.
 */
export function ConversationsTab(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey/conversations" });
  const role = useQuery(roleQueries.one(roleKey));
  const threads = useQuery(threadQueries.inChat(roleKey));
  const chat = useChat();
  if (!role.data || !threads.data) return null;
  const { name, capabilities } = role.data.card;
  return (
    <div className="person-columns">
      <div className="person-column">
        <PersonBlock
          icon="message-circle"
          title={`Chat threads · ${threads.data.length}`}
          actions={
            capabilities.chat && (
              <Button size="sm" variant="secondary" onClick={() => chat.open(roleKey)}>
                Open the chat
              </Button>
            )
          }
        >
          {!capabilities.chat && (
            <p className="person-note">
              Chat is off for {name}: talk to them on a Task. It can be turned on on the Role card;
              earlier Threads stay readable.
            </p>
          )}
          {threads.data.length > 0 ? (
            <ul className="person-threads">
              {threads.data.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  personName={name}
                  onOpen={() => chat.open(roleKey, thread.id)}
                />
              ))}
            </ul>
          ) : (
            capabilities.chat && <p className="person-note">No threads yet.</p>
          )}
        </PersonBlock>
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  personName,
  onOpen,
}: {
  readonly thread: Thread;
  readonly personName: string;
  readonly onOpen: () => void;
}): ReactNode {
  const { input, output, cacheRead, cacheCreation } = thread.tokens;
  return (
    <li>
      <button type="button" className="person-thread" onClick={onOpen}>
        <Icon name="message-circle" size={14} />
        <span className="person-thread-title">{thread.title ?? "New thread"}</span>
        <span className="person-thread-meta">
          {contextLabel(thread.context, personName)} ·{" "}
          {tokensShort(input + output + cacheRead + cacheCreation)} tokens
        </span>
        <span className="person-thread-time">{dayAndClockOf(thread.startedAt)}</span>
      </button>
    </li>
  );
}
