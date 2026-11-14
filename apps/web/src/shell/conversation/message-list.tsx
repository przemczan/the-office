import { useQuery } from "@tanstack/react-query";
import type { Message, MessageDelivery } from "@the-office/contracts";
import { Avatar, Icon, TextButton } from "@the-office/ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { roleQueries } from "../../api/people.ts";
import { OpenPageChip } from "../open-page-chip.tsx";
import { PersonAvatar } from "../person-avatar.tsx";
import { roleFirstName, roleName } from "../person-name.ts";
import { clockOf } from "../time.ts";
import { usageWindowUsedUpWords } from "../usage-window-words.ts";
import { userName, useSignedInUserId, useUserName, type UserNamer } from "../use-user-name.ts";
import { contextLabel } from "./context-words.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { DecisionInThread } from "./decision-card.tsx";
import { answerWords, atUsersRequestWords } from "./decision-words.ts";
import { IdeaCard } from "./idea-card.tsx";
import { LinkCard } from "./link-card.tsx";
import {
  groupedMessages,
  withDayLines,
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
  roleKey,
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
  /** Whose Thread it is. */
  readonly roleKey: string;
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
  const readerLeftEnd = useRef(false);
  // What the list shows at its end: each new message, or the person starting to answer, scrolls to it.
  // A Decision's link opens the list at its card instead, once. Only the list scrolls, never the page
  // around it, so scrollIntoView, which scrolls every scrolling ancestor, is left out.
  const visible = visibleMessages(messages, details);
  const lines = visible.length + (answering ? 1 : 0);
  const endsWithUsersMessage = visible.at(-1)?.kind === "user";
  useEffect(() => {
    const scroller = list.current;
    if (inTimeline || lines === 0 || scroller === null) return;
    if (leavesReaderBe && readerLeftEnd.current && !endsWithUsersMessage) return;
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
  }, [inTimeline, leavesReaderBe, lines, endsWithUsersMessage]);
  // A timeline follows its growing content itself, and a list in one doesn't scroll.
  const showEnd = useCallback((): void => {
    const scroller = list.current;
    if (!inTimeline && scroller !== null) scroller.scrollTop = scroller.scrollHeight;
  }, [inTimeline]);
  const followEnd = useCallback((): void => {
    if (!readerLeftEnd.current) showEnd();
  }, [showEnd]);
  return (
    <div
      className={inTimeline ? "message-list in-timeline" : "message-list"}
      aria-live="polite"
      ref={list}
      onScroll={({ currentTarget: { scrollHeight, scrollTop, clientHeight } }) => {
        readerLeftEnd.current = scrollHeight - scrollTop - clientHeight > FOLLOWING_DISTANCE_PX;
      }}
    >
      {withDayLines(withLogLines(groupedMessages(visible), logLines)).map((piece) =>
        piece.kind === "line" ? (
          <p key={piece.line.id} className="message-log-line">
            {piece.line.words}
          </p>
        ) : (
          <GroupItem
            key={piece.id}
            group={piece}
            roleKey={roleKey}
            personName={personName}
            stageThread={stageThread}
            handoverNoteReader={handoverNoteReader}
          />
        ),
      )}
      {answering && (
        <Working
          roleKey={roleKey}
          personName={personName}
          toolCall={details ? undefined : latestToolCall(messages)}
          onToolCallOpened={showEnd}
          onOpenToolCallChanged={followEnd}
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

/**
 * The person is answering, with the tool call they are on while Details hides the log's own. The
 * fold's state lives here, as a call with nothing to open takes the fold away until the next one.
 */
function Working({
  roleKey,
  personName,
  toolCall,
  onToolCallOpened,
  onOpenToolCallChanged,
}: {
  readonly roleKey: string;
  readonly personName: string;
  readonly toolCall: ToolCall | undefined;
  readonly onToolCallOpened: () => void;
  readonly onOpenToolCallChanged: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const openCall = open ? toolCall?.id : undefined;
  useEffect(() => {
    if (openCall !== undefined) onOpenToolCallChanged();
  }, [openCall, onOpenToolCallChanged]);
  const onToggle = (nowOpen: boolean): void => {
    // A fold coming back already open reports a toggle too, which the user didn't make.
    if (nowOpen === open) return;
    setOpen(nowOpen);
    if (nowOpen) onToolCallOpened();
  };
  return (
    <div className="message-answering" role="status">
      <span aria-hidden="true">
        <PersonAvatar roleKey={roleKey} name={personName} size="xs" />
      </span>
      <span className="message-answering-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{personName} is working</span>
      {toolCall && <WorkingToolCall call={toolCall} open={open} onToggle={onToggle} />}
    </div>
  );
}

/** One line beside "is working", opening to the call shown whole; with no command, just the tool. */
function WorkingToolCall({
  call,
  open,
  onToggle,
}: {
  readonly call: ToolCall;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
}): ReactNode {
  if (call.summary === "") return <ToolCallWords call={call} />;
  return (
    <details
      className="tool-calls tool-call-fold working-tool-call"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <ToolCallFoldSummary latest={call} />
      <ToolCallLines calls={[call]} />
    </details>
  );
}

function GroupItem({
  group,
  roleKey,
  personName,
  stageThread,
  handoverNoteReader,
}: {
  readonly group: MessageGroup;
  readonly roleKey: string;
  readonly personName: string;
  readonly stageThread: boolean;
  readonly handoverNoteReader: HandoverNoteReader | undefined;
}): ReactNode {
  switch (group.kind) {
    case "turn":
      return (
        <Turn
          messages={group.messages}
          roleKey={roleKey}
          personName={personName}
          stageThread={stageThread}
        />
      );
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
  roleKey,
  personName,
  stageThread,
}: {
  readonly messages: readonly [TurnMessage, ...TurnMessage[]];
  readonly roleKey: string;
  readonly personName: string;
  readonly stageThread: boolean;
}): ReactNode {
  const [opening] = messages;
  const nameOfUser = useUserName();
  const writer = opening.kind === "user" ? nameOfUser(opening.writtenBy) : "";
  return (
    <TurnFrame
      avatar={
        opening.kind === "user" ? (
          <UserAvatar name={writer} />
        ) : (
          <PersonAvatar roleKey={roleKey} name={personName} size="xs" />
        )
      }
      by={<TurnAuthor opening={opening} personName={personName} writer={writer} />}
      at={opening.at}
      labelled={opening.kind === "user" && opening.handoverNoteFrom !== null}
    >
      {messages.map((message) => (
        <div key={message.id}>
          <div className="message-text">
            <MarkdownText text={message.text} />
          </div>
          {message.kind === "user" && message.openPage && (
            <p className="message-open-page">
              With <OpenPageChip page={message.openPage} /> open
            </p>
          )}
          {stageThread && message.kind === "user" && <DeliveryMark delivery={message.delivery} />}
        </div>
      ))}
    </TurnFrame>
  );
}

function TurnAuthor({
  opening,
  personName,
  writer,
}: {
  readonly opening: TurnMessage;
  readonly personName: string;
  /** "You", or the name of the user who wrote it. */
  readonly writer: string;
}): ReactNode {
  if (opening.kind === "person") return personName;
  if (opening.handoverNoteFrom === null) return writer;
  return <HandoverNoteFrom roleKey={opening.handoverNoteFrom} />;
}

/** A user's avatar, "You" for the signed-in user's own: gray, as a user isn't a person. */
function UserAvatar({ name }: { readonly name: string }): ReactNode {
  return <Avatar name={name} size="xs" style={YOUR_AVATAR_COLOURS} />;
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

/** A lone call shows whole, with nothing to open; neighbouring calls fold. */
function ToolCalls({ calls }: { readonly calls: readonly [ToolCall, ...ToolCall[]] }): ReactNode {
  const [first, ...others] = calls;
  const latest = others.at(-1);
  if (latest) return <ToolCallFold calls={calls} latest={latest} />;
  return (
    <div className="tool-calls">
      <div className="message-line">
        <Icon name="wrench" size={12} />
        <ToolCallWords call={first} />
      </div>
    </div>
  );
}

/** One line with the count and the latest call, opening to every call shown whole. */
function ToolCallFold({
  calls,
  latest,
}: {
  readonly calls: readonly ToolCall[];
  readonly latest: ToolCall;
}): ReactNode {
  return (
    <details className="tool-calls tool-call-fold">
      <ToolCallFoldSummary latest={latest}>
        <span className="tool-call-count">{calls.length} tool calls</span>
        <span aria-hidden="true">·</span>
      </ToolCallFoldSummary>
      <ToolCallLines calls={calls} />
    </details>
  );
}

function ToolCallFoldSummary({
  latest,
  children,
}: {
  readonly latest: ToolCall;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <summary>
      <Icon name="chevron-right" size={12} />
      {children}
      <span className="tool-call-latest">
        {latest.tool} {latest.summary}
      </span>
    </summary>
  );
}

function ToolCallLines({ calls }: { readonly calls: readonly ToolCall[] }): ReactNode {
  return (
    <ul>
      {calls.map((call) => (
        <li key={call.id} className="message-line">
          <ToolCallWords call={call} />
        </li>
      ))}
    </ul>
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
  const nameOfUser = useUserName();
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
        <div className="message-notice refused">
          <Icon name="shield-x" size={12} />
          <span>
            <b>{message.tool} refused:</b> {message.reason}
          </span>
        </div>
      );
    case "mcp-server-not-started":
      return (
        <div className="message-notice failed">
          <Icon name="triangle-alert" size={12} />
          <span>
            The MCP server {message.server} didn't start
            {message.reason === null ? "." : `: ${message.reason}`}
          </span>
        </div>
      );
    case "consultation-line":
      return (
        <div className="message-notice">
          <Icon name="users" size={12} />
          <span>
            <MarkdownText text={message.text} inline />
          </span>
        </div>
      );
    case "context":
      return <ContextLine line={message} personName={personName} />;
    case "changes-allowed":
      return <div className="message-office">{changesAllowedWords(message, nameOfUser)}</div>;
    case "failure":
      return (
        <div className="message-notice failed">
          <Icon name="circle-alert" size={12} />
          <span>
            {message.reason} · {clockOf(message.at)}
          </span>
        </div>
      );
    case "usage-window-used-up":
      return (
        <div className="message-office">
          <Icon name="pause" size={12} />
          <span>{usageWindowUsedUpWords(message)}</span>
        </div>
      );
    case "held":
      return (
        <div className="message-office">
          {/* The fire alarm holds a Stage as a Pause does: it goes on after the all clear. */}
          <Icon name={message.heldBy === "stop" ? "square" : "pause"} size={12} />
          <span>{message.text}</span>
        </div>
      );
    case "decision":
      return <DecisionInThread decision={message.decision} personName={personName} />;
    case "decision-answer":
      return <DecisionAnswerItem message={message} />;
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

/** The Office's line on a user allowing changes or switching them off, "by you" or by their name. */
function changesAllowedWords(
  { allowed, by }: Extract<Message, { kind: "changes-allowed" }>,
  nameOfUser: UserNamer,
): string {
  const words = allowed ? "Changes allowed" : "Changes switched off";
  return by === null ? words : `${words} by ${nameOfUser(by, "you")}`;
}

/**
 * The answer to a Decision, as it went to the person who asked: the user's, the Consultant's it was
 * put to, or the one a person gave for the user at their request, under that person's name. The
 * Office's, sending a call made from a chat back to its caller, is a line of its own.
 */
function DecisionAnswerItem({
  message,
}: {
  readonly message: Extract<Message, { kind: "decision-answer" }>;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const signedInUserId = useSignedInUserId();
  const words = answerWords(message.answer, message.decision);
  if (message.decision.answeredByTheOffice) {
    return (
      <div className="message-office">
        <MarkdownText text={words} inline />
      </div>
    );
  }
  const answerer = answererOf(message, roles, signedInUserId);
  const user = userName(message.decision.answeredByUser, signedInUserId);
  return (
    <TurnFrame
      avatar={
        answerer === null ? (
          <UserAvatar name={user} />
        ) : (
          <PersonAvatar roleKey={answerer.roleKey} name={answerer.name} size="xs" />
        )
      }
      by={
        answerer === null
          ? `${user} · answering the Decision`
          : `${answerer.name} · ${answerer.how}`
      }
      at={message.at}
      labelled
    >
      <div className="message-text">
        <MarkdownText text={words} />
      </div>
    </TurnFrame>
  );
}

/** The person who gave the answer, and how; null when the user did. */
function answererOf(
  { atUsersRequest, decision }: Extract<Message, { kind: "decision-answer" }>,
  roles: Parameters<typeof roleFirstName>[1],
  signedInUserId: string | undefined,
): { readonly roleKey: string; readonly name: string; readonly how: string } | null {
  if (atUsersRequest) {
    return {
      roleKey: atUsersRequest.roleKey,
      name: roleFirstName(atUsersRequest.roleKey, roles),
      how: `answering the Decision ${atUsersRequestWords(atUsersRequest.user, signedInUserId)}`,
    };
  }
  if (decision.answeredBy) {
    return {
      roleKey: decision.answeredBy,
      name: roleFirstName(decision.answeredBy, roles),
      how: "answering in a Consultation",
    };
  }
  return null;
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
