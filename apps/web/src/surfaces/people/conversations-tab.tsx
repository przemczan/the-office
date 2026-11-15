import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  countedTokens,
  type Project,
  type TaskThreadSummary,
  type ThreadSummary,
} from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { rowsOf, totalOf } from "../../api/pages.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { useChat } from "../../shell/chat/use-chat.tsx";
import { contextLabel, tokensShort } from "../../shell/conversation/context-words.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { ShowMore } from "../../shell/show-more.tsx";
import { dayAndClockOf } from "../../shell/time.ts";
import { PersonBlock } from "./role-card-layout.tsx";

/**
 * The person's chat Threads, each opening in the chat, and their Threads on Tasks, each opening on
 * its Task's page (prototypes/app/people.js), each list a page at a time with its whole count in
 * its heading. Consultations come in tier 2.
 */
export function ConversationsTab(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey/conversations" });
  const role = useQuery(roleQueries.one(roleKey));
  const threads = useInfiniteQuery(threadQueries.inChat(roleKey));
  const chat = useChat();
  if (!role.data || !threads.data) return null;
  const { name, capabilities } = role.data.card;
  const shown = rowsOf(threads.data);
  return (
    <div className="person-columns">
      <div className="person-column">
        <PersonBlock
          icon="message-circle"
          title={`Chat threads · ${totalOf(threads.data)}`}
          actions={
            capabilities.chat &&
            !role.data.letGoAt && (
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
          {shown.length > 0 ? (
            <>
              <ul className="person-threads">
                {shown.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    personName={name}
                    onOpen={() => chat.open(roleKey, thread.id)}
                  />
                ))}
              </ul>
              <ShowMore list={threads} />
            </>
          ) : (
            capabilities.chat && <p className="person-note">No threads yet.</p>
          )}
        </PersonBlock>
      </div>
      <div className="person-column">
        <ThreadsOnTasks roleKey={roleKey} />
      </div>
    </div>
  );
}

/** The person's Threads on Tasks, the newest first, each named with its Task and Project. */
function ThreadsOnTasks({ roleKey }: { readonly roleKey: string }): ReactNode {
  const threads = useInfiniteQuery(threadQueries.onTasksWith(roleKey));
  const projects = useQuery(projectQueries.list());
  if (!threads.data) return null;
  const onTasks = rowsOf(threads.data);
  return (
    <PersonBlock icon="square-check-big" title={`Threads on Tasks · ${totalOf(threads.data)}`}>
      {onTasks.length > 0 ? (
        <>
          <ul className="person-threads">
            {onTasks.map((thread) => (
              <TaskThreadRow key={thread.id} thread={thread} projects={projects.data} />
            ))}
          </ul>
          <ShowMore list={threads} />
        </>
      ) : (
        <p className="person-note">None yet.</p>
      )}
    </PersonBlock>
  );
}

function TaskThreadRow({
  thread,
  projects,
}: {
  readonly thread: TaskThreadSummary;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const { task } = thread;
  const project = projects?.find(({ id }) => id === task.projectId);
  return (
    <li>
      <Link
        to="/tasks/$taskId"
        params={{ taskId: task.id }}
        search={{ taskThread: thread.id }}
        className="person-thread"
      >
        <Icon name="message-square" size={14} />
        <span className="person-thread-title">{thread.title ?? "A Thread"}</span>
        <span className="person-thread-meta">{task.title}</span>
        {project && (
          <span className="person-thread-mark">
            <ProjectMark project={project} />
          </span>
        )}
      </Link>
    </li>
  );
}

function ThreadRow({
  thread,
  personName,
  onOpen,
}: {
  readonly thread: ThreadSummary;
  readonly personName: string;
  readonly onOpen: () => void;
}): ReactNode {
  return (
    <li>
      <button type="button" className="person-thread" onClick={onOpen}>
        <Icon name="message-circle" size={14} />
        <span className="person-thread-title">{thread.title ?? "New thread"}</span>
        <span className="person-thread-meta">
          {contextLabel(thread.context, personName)} · {tokensShort(countedTokens(thread.tokens))}{" "}
          tokens
        </span>
        <span className="person-thread-time">{dayAndClockOf(thread.startedAt)}</span>
      </button>
    </li>
  );
}
