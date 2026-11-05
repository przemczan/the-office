import { useQuery } from "@tanstack/react-query";
import type { Message, MessageDelivery } from "@the-office/contracts";
import { Avatar, Icon, TextButton } from "@the-office/ui";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { roleName } from "../person-name.ts";
import { clockOf } from "../time.ts";
import { contextLabel } from "./context-words.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { DecisionInThread } from "./decision-card.tsx";
import { answerWords } from "./decision-words.ts";
import { IdeaCard } from "./idea-card.tsx";
import { LinkCard } from "./link-card.tsx";
import {
  groupedMessages,
  withLogLines,
  type LogLine,
  type MessageGroup,
  type ToolCall,
  type TurnMessage,
} from "./message-groups.ts";
import { latestToolCall, onlyDetailsWouldShow, visibleMessages } from "./message-visibility.ts";
import { OfficeStatusCard } from "./office-status-card.tsx";
import { ProposalCard } from "./proposal-card.tsx";

const NO_LOG_LINES: readonly LogLine[] = [];

/** How far from the end a reader still counts as following it. */
const FOLLOWING_DISTANCE_PX = 40;

/** The gray of the Avatar's own tints: its tint comes from the name, and the user isn't a person. */
const YOUR_AVATAR_COLOURS: CSSProperties = {
  background: "var(--gray-100)",
  color: "var(--gray-700)",
};

/** How to read a Handover note whole, when somewhere else holds it. */
export type HandoverNoteReader = (note: string) => (() => void) | undefined;

/**
 * The Office's log of a Thread (spec §2.4): the user's messages and the person's, what the person
 * did with tools, what was refused, and The Office's own lines, never shown as a person's.
 */
export function MessageList({
  messages,
  personName,
  answering,
  stageThread,
  details,
  inTimeline = false,
  leavesReaderBe = false,
  logLines = NO_LOG_LINES,
  handoverNoteReader,
}: {
  readonly messages: readonly Message[];
  readonly personName: string;
  /** The person is writing an answer now. */
  readonly answering: boolean;
  /** The user's messages say whether they reached the person, as one written while the Stage runs waits. */
  readonly stageThread: boolean;
  /** The Details switch: tool activity and the context lines show. */
  readonly details: boolean;
  /** One chapter of a timeline, which scrolls and lands on a linked card itself. */
  readonly inTimeline?: boolean;
  /** A reader who scrolled up stays there as the log grows, but for what they send themselves. */
  readonly leavesReaderBe?: boolean;
  /** What isn't a message but belongs in the log by its time. */
  readonly logLines?: readonly LogLine[];
  /** A note it can lead to shows its first lines here; any other shows whole. */
  readonly handoverNoteReader?: HandoverNoteReader | undefined;
}): ReactNode {
  const list = useRef<HTMLDivElement>(null);
  const shownLinkedTo = useRef(false);
  const readerScrolledUp = useRef(false);
  // What the list shows at its end: each new message, or the person starting to answer, scrolls to it.
  // A Decision's link opens the list at its card instead, once. Only the list scrolls, never the page
  // around it, so scrollIntoView, which scrolls every scrolling ancestor, is left out.
  const visible = visibleMessages(messages, details);
  const lines = visible.length + (answering ? 1 : 0);
  const endsWithUsersMessage = visible.at(-1)?.kind === "user";
  useEffect(() => {
    const scroller = list.current;
    if (inTimeline || lines === 0 || scroller === null) return;
    if (readerScrolledUp.current && !endsWithUsersMessage) return;
    const linkedTo = shownLinkedTo.current
      ? null
      : scroller.querySelector(".decision-card.linked-to");
    if (linkedTo) {
      shownLinkedTo.current = true;
      const card = linkedTo.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      scroller.scrollTop +=
        card.top - view.top - scroller.clientTop - (scroller.clientHeight - card.height) / 2;
    } else {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [inTimeline, lines, endsWithUsersMessage]);
  return (
    <div
      className={inTimeline ? "message-list in-timeline" : "message-list"}
      aria-live="polite"
      ref={list}
      onScroll={({ currentTarget: { scrollHeight, scrollTop, clientHeight } }) => {
        readerScrolledUp.current =
          leavesReaderBe && scrollHeight - scrollTop - clientHeight > FOLLOWING_DISTANCE_PX;
      }}
    >
      {withLogLines(groupedMessages(visible), logLines).map((piece) =>
        piece.kind === "line" ? (
          <p key={piece.line.id} className="message-log-line">
            {piece.line.words}
          </p>
        ) : (
          <GroupItem
            key={piece.id}
            group={piece}
            personName={personName}
            stageThread={stageThread}
            handoverNoteReader={handoverNoteReader}
          />
        ),
      )}
      {answering && (
        <Working
          personName={personName}
          toolCall={details ? undefined : latestToolCall(messages)}
        />
      )}
      {onlyDetailsWouldShow(messages, details, answering) && (
        <p className="message-details-hidden">
          Tool activity is hidden. Turn on Details to see it.
        </p>
      )}
    </div>
  );
}

/** The person is answering, with the tool call they are on while Details hides the log's own. */
function Working({
  personName,
  toolCall,
}: {
  readonly personName: string;
  readonly toolCall: ToolCall | undefined;
}): ReactNode {
  return (
    <div className="message-answering" role="status">
      <span className="message-answering-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {personName} is working
      {toolCall && <ToolCallWords call={toolCall} />}
    </div>
  );
}

function GroupItem({
  group,
  personName,
  stageThread,
  handoverNoteReader,
}: {
  readonly group: MessageGroup;
  readonly personName: string;
  readonly stageThread: boolean;
  readonly handoverNoteReader: HandoverNoteReader | undefined;
}): ReactNode {
  switch (group.kind) {
    case "turn":
      return <Turn messages={group.messages} personName={personName} stageThread={stageThread} />;
    case "tool-calls":
      return <ToolCalls calls={group.messages} />;
    case "alone":
      return (
        <MessageItem
          message={group.message}
          personName={personName}
          handoverNoteReader={handoverNoteReader}
        />
      );
  }
}

/** One author's run of messages under one line; each of the user's keeps its own delivery mark. */
function Turn({
  messages,
  personName,
  stageThread,
}: {
  readonly messages: readonly [TurnMessage, ...TurnMessage[]];
  readonly personName: string;
  readonly stageThread: boolean;
}): ReactNode {
  const [opening] = messages;
  return (
    <TurnFrame
      avatar={opening.kind === "user" ? <YourAvatar /> : <Avatar name={personName} size="xs" />}
      by={<TurnAuthor opening={opening} personName={personName} />}
      at={opening.at}
      labelled={opening.kind === "user" && opening.handoverNoteFrom !== null}
    >
      {messages.map((message) => (
        <div key={message.id}>
          <div className="message-text">
            <MarkdownText text={message.text} />
          </div>
          {stageThread && message.kind === "user" && <DeliveryMark delivery={message.delivery} />}
        </div>
      ))}
    </TurnFrame>
  );
}

function TurnAuthor({
  opening,
  personName,
}: {
  readonly opening: TurnMessage;
  readonly personName: string;
}): ReactNode {
  if (opening.kind === "person") return personName;
  if (opening.handoverNoteFrom === null) return "You";
  return <HandoverNoteFrom roleKey={opening.handoverNoteFrom} />;
}

function YourAvatar(): ReactNode {
  return <Avatar name="You" size="xs" style={YOUR_AVATAR_COLOURS} />;
}

/** A row of the log: the avatar on the left, the name and the time over what was said. */
function TurnFrame({
  avatar,
  by,
  at,
  labelled = false,
  children,
}: {
  readonly avatar: ReactNode;
  readonly by: ReactNode;
  readonly at: string;
  /** The name carries a note on what the turn is, so it reads quieter than a plain name. */
  readonly labelled?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className={labelled ? "turn labelled" : "turn"}>
      <div className="turn-avatar" aria-hidden="true">
        {avatar}
      </div>
      <div className="turn-body">
        <div className="turn-by">
          <span className="turn-author">{by}</span>
          <span>{clockOf(at)}</span>
        </div>
        <div className="turn-messages">{children}</div>
      </div>
    </div>
  );
}

function ToolCalls({ calls }: { readonly calls: readonly ToolCall[] }): ReactNode {
  return (
    <div className="tool-calls">
      {calls.map((call) => (
        <div key={call.id} className="message-line">
          <Icon name="wrench" size={12} />
          <ToolCallWords call={call} />
        </div>
      ))}
    </div>
  );
}

function ToolCallWords({ call: { tool, summary } }: { readonly call: ToolCall }): ReactNode {
  return (
    <>
      <span className="message-tool">{tool}</span>
      {summary !== "" && <span className="message-summary">{summary}</span>}
    </>
  );
}

function MessageItem({
  message,
  personName,
  handoverNoteReader,
}: {
  readonly message: Extract<MessageGroup, { kind: "alone" }>["message"];
  readonly personName: string;
  readonly handoverNoteReader: HandoverNoteReader | undefined;
}): ReactNode {
  switch (message.kind) {
    case "handover-note":
      return (
        <HandoverNoteItem
          text={message.text}
          personName={personName}
          readInFull={handoverNoteReader?.(message.text)}
        />
      );
    case "refusal":
      return (
        <div className="message-line refused">
          <Icon name="shield-x" size={12} />
          <span className="message-tool">{message.tool} refused</span>
          <span className="message-summary">{message.reason}</span>
        </div>
      );
    case "mcp-server-not-started":
      return (
        <div className="message-line failed">
          <Icon name="triangle-alert" size={12} />
          <span className="message-summary">
            The MCP server {message.server} didn't start
            {message.reason === null ? "." : `: ${message.reason}`}
          </span>
        </div>
      );
    case "context":
      return <ContextLine line={message} personName={personName} />;
    case "changes-allowed":
      return (
        <div className="message-office">
          {message.allowed ? "Changes allowed" : "Changes switched off"}
        </div>
      );
    case "failure":
      return (
        <div className="message-line failed">
          <Icon name="circle-alert" size={12} />
          <span className="message-summary">
            {message.reason} · {clockOf(message.at)}
          </span>
        </div>
      );
    case "held":
      return (
        <div className="message-line held">
          {/* The fire alarm holds a Stage as a Pause does: it goes on after the all clear. */}
          <Icon name={message.heldBy === "stop" ? "square" : "pause"} size={12} />
          <span className="message-summary">{message.text}</span>
        </div>
      );
    case "decision":
      return <DecisionInThread decision={message.decision} personName={personName} />;
    case "decision-answer":
      return (
        <TurnFrame
          avatar={<YourAvatar />}
          by="You · answering the Decision"
          at={message.at}
          labelled
        >
          <div className="message-text">
            <MarkdownText text={answerWords(message.answer, message.decision)} />
          </div>
        </TurnFrame>
      );
    case "proposal":
      return <ProposalCard proposal={message.proposal} />;
    case "link-card":
      return <LinkCard card={message} />;
    case "idea":
      return <IdeaCard card={message} />;
    case "office-status":
      return <OfficeStatusCard card={message} />;
  }
}

/** A Handover note in the stream: its first lines when it reads whole elsewhere (spec 4.1). */
function HandoverNoteItem({
  text,
  personName,
  readInFull,
}: {
  readonly text: string;
  readonly personName: string;
  readonly readInFull: (() => void) | undefined;
}): ReactNode {
  return (
    <div className="message handover-note">
      <div className="message-by">
        <Icon name="sticky-note" size={12} />
        Handover note · {personName}
      </div>
      <div className={readInFull ? "message-text handover-note-start" : "message-text"}>
        <MarkdownText text={text} />
      </div>
      {readInFull && (
        <TextButton className="handover-note-read" onClick={readInFull}>
          Read it in full
        </TextButton>
      )}
    </div>
  );
}

/** The user sent the Handover note a Link card gave them, edited or not: its writer, named. */
function HandoverNoteFrom({ roleKey }: { readonly roleKey: string }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  return (
    <>
      <Icon name="sticky-note" size={12} />
      You · Handover note from {roleName(roleKey, roles)}
    </>
  );
}

const DELIVERY_MARKS: Readonly<Record<MessageDelivery, { icon: string; words: string }>> = {
  waiting: { icon: "clock", words: "Lands at the next safe point" },
  delivered: { icon: "check", words: "Delivered" },
  "not-delivered": { icon: "circle-x", words: "Not delivered: the Stage ended first" },
};

/** Whether the user's message reached the person, written while the Stage ran (barge-in). */
function DeliveryMark({ delivery }: { readonly delivery: MessageDelivery }): ReactNode {
  const { icon, words } = DELIVERY_MARKS[delivery];
  return (
    <div className={`message-delivery ${delivery}`}>
      <Icon name={icon} size={12} />
      {words}
    </div>
  );
}

/**
 * The Context policy's move; one that started a session with a Brief opens to show it, read only
 * once opened so a closed line holds nothing but its label.
 */
function ContextLine({
  line,
  personName,
}: {
  readonly line: Extract<Message, { kind: "context" }>;
  readonly personName: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const label = contextLabel(line, personName);
  if (line.brief === null) return <div className="message-office">{label}</div>;
  return (
    <details
      className="message-office message-brief"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {label}
        <span className="message-brief-toggle">
          <Icon name="chevron-down" size={12} />
          Brief
        </span>
      </summary>
      {open && (
        <div className="message-brief-text">
          <MarkdownText text={line.brief} />
        </div>
      )}
    </details>
  );
}
