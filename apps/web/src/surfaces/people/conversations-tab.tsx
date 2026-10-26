import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { Project, Task, Thread } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries } from "../../api/work.ts";
import { useChat } from "../../shell/chat/use-chat.ts";
import { contextLabel, tokensShort } from "../../shell/conversation/context-words.ts";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { dayAndClockOf } from "../../shell/time.ts";
import { PersonBlock } from "./role-card-layout.tsx";

/**
 * The person's chat Threads, each opening in the chat, and their Threads on Tasks, each opening on
 * its Task's page (prototypes/app/people.js). Consultations come in tier 2.
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
      <div className="person-column">
        <ThreadsOnTasks roleKey={roleKey} />
      </div>
    </div>
  );
}

/** The person's Threads on Tasks, the newest first, each named with its Task and Project. */
function ThreadsOnTasks({ roleKey }: { readonly roleKey: string }): ReactNode {
  const threads = useQuery(threadQueries.onTasksWith(roleKey));
  const tasks = useQuery(taskQueries.list());
  const projects = useQuery(projectQueries.list());
  if (!threads.data || !tasks.data) return null;
  const onTasks = threads.data.flatMap((thread) => {
    const task = tasks.data.find(
      ({ id }) => thread.home.kind === "task" && thread.home.taskId === id,
    );
    return task ? [{ thread, task }] : [];
  });
  return (
    <PersonBlock icon="square-check-big" title={`Threads on Tasks · ${onTasks.length}`}>
      {onTasks.length > 0 ? (
        <ul className="person-threads">
          {onTasks.map(({ thread, task }) => (
            <TaskThreadRow key={thread.id} thread={thread} task={task} projects={projects.data} />
          ))}
        </ul>
      ) : (
        <p className="person-note">None yet.</p>
      )}
    </PersonBlock>
  );
}

function TaskThreadRow({
  thread,
  task,
  projects,
}: {
  readonly thread: Thread;
  readonly task: Task;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
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
