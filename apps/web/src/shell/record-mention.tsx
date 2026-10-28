import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { RecordLink } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { ideaQueries, initiativeQueries, taskQueries } from "../api/work.ts";
import { MENTION_KINDS } from "./conversation/mention-words.ts";
import "./record-mention.css";

/**
 * A Task, Initiative, Decision or Idea mentioned in a message (spec §2.4), shown as a chip linking to it in the
 * app, named as the record is now. Until it is read, or once it is gone, the words written stand.
 */
export function RecordMention({
  link,
  written,
}: {
  readonly link: RecordLink;
  /** The link's own words in the message. */
  readonly written: ReactNode;
}): ReactNode {
  switch (link.kind) {
    case "task":
      return <TaskMention taskId={link.taskId} written={written} />;
    case "decision":
      return (
        <DecisionMention
          taskId={link.taskId}
          threadId={link.threadId}
          decisionId={link.decisionId}
          written={written}
        />
      );
    case "initiative":
      return <InitiativeMention initiativeId={link.initiativeId} written={written} />;
    case "idea":
      return <IdeaMention ideaId={link.ideaId} written={written} />;
  }
}

function TaskMention({
  taskId,
  written,
}: {
  readonly taskId: string;
  readonly written: ReactNode;
}): ReactNode {
  const title = useQuery(taskQueries.one(taskId)).data?.title;
  return (
    <Link className="record-mention" to="/tasks/$taskId" params={{ taskId }} title="Task">
      <Icon name={MENTION_KINDS.task.icon} size={12} />
      {title ?? shownWords(written, "task")}
    </Link>
  );
}

function DecisionMention({
  taskId,
  threadId,
  decisionId,
  written,
}: {
  readonly taskId: string;
  readonly threadId: string | undefined;
  readonly decisionId: string;
  readonly written: ReactNode;
}): ReactNode {
  const title = useQuery(taskQueries.one(taskId)).data?.title;
  return (
    <Link
      className="record-mention"
      to="/tasks/$taskId"
      params={{ taskId }}
      search={{ ...(threadId !== undefined && { taskThread: threadId }), decision: decisionId }}
      title="Decision"
    >
      <Icon name={MENTION_KINDS.decision.icon} size={12} />
      {title === undefined ? shownWords(written, "decision") : `Decision on ${title}`}
    </Link>
  );
}

function IdeaMention({
  ideaId,
  written,
}: {
  readonly ideaId: string;
  readonly written: ReactNode;
}): ReactNode {
  const title = useQuery(ideaQueries.one(ideaId)).data?.title;
  return (
    <Link className="record-mention" to="/work/ideas" search={{ idea: ideaId }} title="Idea">
      <Icon name={MENTION_KINDS.idea.icon} size={12} />
      {title ?? shownWords(written, "idea")}
    </Link>
  );
}

function InitiativeMention({
  initiativeId,
  written,
}: {
  readonly initiativeId: string;
  readonly written: ReactNode;
}): ReactNode {
  const name = useQuery(initiativeQueries.one(initiativeId)).data?.name;
  return (
    <Link
      className="record-mention"
      to="/work/initiatives/$initiativeId"
      params={{ initiativeId }}
      title="Initiative"
    >
      <Icon name={MENTION_KINDS.initiative.icon} size={12} />
      {name ?? shownWords(written, "initiative")}
    </Link>
  );
}

/** The words written for the link, without the `@`; a pasted URL shows as the record's kind. */
function shownWords(written: ReactNode, kind: RecordLink["kind"]): ReactNode {
  if (typeof written !== "string") return written;
  if (/^(https?:\/\/|\/)/.test(written)) return MENTION_KINDS[kind].word;
  return written.replace(/^@/, "");
}
