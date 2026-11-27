import { useQuery } from "@tanstack/react-query";
import type { Message, MessageDelivery, MessageImage } from "@the-office/contracts";
import { Avatar, Badge, Button, Icon, TextButton } from "@the-office/ui";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { roleQueries } from "../../api/people.ts";
import { AttachmentViewer, type ViewedImage } from "../attachments/attachment-viewer.tsx";
import { ImageThumbnail } from "../attachments/image-thumbnail.tsx";
import { OpenPageChip } from "../open-page-chip.tsx";
import { PersonAvatar } from "../person-avatar.tsx";
import { roleFirstName, roleName } from "../person-name.ts";
import { clockOf } from "../time.ts";
import { engineSwitchedWords, usageWindowUsedUpWords } from "../usage-window-words.ts";
import {
  isSignedInUser,
  userName,
  useSignedInUserId,
  useUserName,
  type UserNamer,
} from "../use-user-name.ts";
import {
  contextLabel,
  earlierSessionLabel,
  newSessionLabel,
  stageContextLimitWords,
  stageSessionRestartedWords,
} from "./context-words.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { DecisionInThread } from "./decision-card.tsx";
import { formAnswerWords } from "./decision-form-words.ts";
import { atUsersRequestWords } from "./decision-words.ts";
import { IdeaCard } from "./idea-card.tsx";
import { LinkCard } from "./link-card.tsx";
import {
  groupedMessages,
  withDayLines,
  withLogLines,
  type LogLine,
  type LogPiece,
  type MessageGroup,
  type ToolCall,
  type TurnMessage,
} from "./message-groups.ts";
import { latestToolCall, onlyDetailsWouldShow, visibleMessages } from "./message-visibility.ts";
import { OfficeStatusCard } from "./office-status-card.tsx";
import { ProposalCard } from "./proposal-card.tsx";
import { stoppedMessages, type UserMessage } from "./stopped-messages.ts";
import { piecesBySession, threadSessions, type ContextLineMessage } from "./thread-sessions.ts";

const NO_LOG_LINES: readonly LogLine[] = [];

/** How far from the end a reader still counts as following it. */
const FOLLOWING_DISTANCE_PX = 40;

/** The gray of the Avatar's own tints: its tint comes from the name, and the user isn't a person. */
const YOUR_AVATAR_COLOURS: CSSProperties = {
  background: "var(--gray-100)",
  color: "var(--gray-700)",
};

/** The card a Decision's or a Proposal's link opened its Thread at. */
export const LINKED_CARD_SELECTOR = ".decision-card.linked-to, .proposal-card.linked-to";

/** Sends a message the Stop kept from landing again, as a new message with the same words and images. */
export type SendAgain = (message: UserMessage) => Promise<unknown>;

/** The user's messages their Stop kept from landing, and what Send again does with one. */
interface StoppedMessages {
  readonly stopped: ReadonlyMap<string, boolean>;
  readonly sendAgain: SendAgain | undefined;
}

const StoppedMessagesContext = createContext<StoppedMessages>({
  stopped: new Map(),
  sendAgain: undefined,
});

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
  onSendAgain,
}: {
  readonly messages: readonly Message[];
  /** Whose Thread it is. */
  readonly roleKey: string;
  readonly personName: string;
  /** The person is writing an answer now. */
  readonly answering: boolean;
  /** A Stage's work runs in it, which a message that never reached the person ended before. */
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
  /** Offered on the user's own message their Stop kept from landing. */
  readonly onSendAgain?: SendAgain | undefined;
}): ReactNode {
  const list = useRef<HTMLDivElement>(null);
  const stopped = useMemo<StoppedMessages>(
    () => ({ stopped: stoppedMessages(messages, stageThread), sendAgain: onSendAgain }),
    [messages, stageThread, onSendAgain],
  );
  const shownLinkedTo = useRef(false);
  const readerLeftEnd = useRef(false);
  // What the list shows at its end: each new message, or the person starting to answer, scrolls to it.
  // A Decision's or a Proposal's link opens the list at its card instead, once. Only the list
  // scrolls, never the page around it, so scrollIntoView, which scrolls every scrolling ancestor,
  // is left out.
  const visible = visibleMessages(messages, details);
  const lines = visible.length + (answering ? 1 : 0);
  const endsWithUsersMessage = visible.at(-1)?.kind === "user";
  useEffect(() => {
    const scroller = list.current;
    if (inTimeline || lines === 0 || scroller === null) return;
    if (leavesReaderBe && readerLeftEnd.current && !endsWithUsersMessage) return;
    const linkedTo = shownLinkedTo.current ? null : scroller.querySelector(LINKED_CARD_SELECTOR);
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
      <StoppedMessagesContext value={stopped}>
        <Sessions
          messages={messages}
          details={details}
          logLines={logLines}
          renderPiece={(piece) =>
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
                answering={answering}
                stageThread={stageThread}
                handoverNoteReader={handoverNoteReader}
              />
            )
          }
          personName={personName}
        />
      </StoppedMessagesContext>
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
 * The log by session: each session started after an earlier one opens with its rule, which shows
 * whatever the Details switch says, and every session but the current one folds. A Thread with one
 * session shows as a plain log.
 */
function Sessions({
  messages,
  details,
  logLines,
  renderPiece,
  personName,
}: {
  readonly messages: readonly Message[];
  readonly details: boolean;
  readonly logLines: readonly LogLine[];
  readonly renderPiece: (piece: LogPiece) => ReactNode;
  readonly personName: string;
}): ReactNode {
  const sessions = threadSessions(messages);
  const shown = sessions.flatMap((session) => [
    ...(session.opening ? [session.opening] : []),
    ...visibleMessages(session.messages, details),
  ]);
  const pieces = withDayLines(withLogLines(groupedMessages(shown), logLines));
  const shared = piecesBySession(pieces, sessions);
  return shared.map(({ session, before, pieces: own }, index) => (
    <Fragment key={session.id}>
      {before.map(renderPiece)}
      {session.opening && <SessionRule line={session.opening} personName={personName} />}
      {index === shared.length - 1 ? (
        own.map(renderPiece)
      ) : (
        <EarlierSession
          messages={visibleMessages(session.messages, details).length}
          endedAtTokens={session.endedAtTokens}
        >
          {own.map(renderPiece)}
        </EarlierSession>
      )}
    </Fragment>
  ));
}

/** The rule a session started after an earlier one opens with, its Brief openable below it. */
function SessionRule({
  line,
  personName,
}: {
  readonly line: ContextLineMessage;
  readonly personName: string;
}): ReactNode {
  return (
    <div className="session-rule">
      <p className="session-rule-line">{newSessionLabel(line, personName)}</p>
      {line.brief !== null && <BriefFold brief={line.brief} />}
    </div>
  );
}

/**
 * An earlier session's messages under one line, closed at first. A Decision's or a Proposal's link
 * opens it at its card, as the log scrolls to the card.
 */
function EarlierSession({
  messages,
  endedAtTokens,
  children,
}: {
  readonly messages: number;
  readonly endedAtTokens: number | null;
  readonly children: ReactNode;
}): ReactNode {
  const fold = useRef<HTMLDetailsElement>(null);
  const openedAtLink = useRef(false);
  useLayoutEffect(() => {
    const shown = fold.current;
    if (openedAtLink.current || shown === null) return;
    if (shown.querySelector(LINKED_CARD_SELECTOR) === null) return;
    openedAtLink.current = true;
    shown.open = true;
  });
  if (messages === 0) return children;
  return (
    <details className="earlier-session" ref={fold}>
      <summary>
        <Icon name="chevron-right" size={12} />
        {earlierSessionLabel(messages, endedAtTokens)}
      </summary>
      <div className="earlier-session-log">{children}</div>
    </details>
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
  answering,
  stageThread,
  handoverNoteReader,
}: {
  readonly group: MessageGroup;
  readonly roleKey: string;
  readonly personName: string;
  readonly answering: boolean;
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
          answering={answering}
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
  const signedInUserId = useSignedInUserId();
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
          {message.kind === "user" && message.skillCommand ? (
            <SkillCommandText skill={message.skillCommand.skill} text={message.text} />
          ) : (
            <div className="message-text">
              <MarkdownText text={message.text} />
            </div>
          )}
          {message.kind === "user" && message.images.length > 0 && (
            <SentImages images={message.images} writer={writer} at={message.at} />
          )}
          {message.kind === "user" && message.openPage && (
            <p className="message-open-page">
              With <OpenPageChip page={message.openPage} /> open
            </p>
          )}
          {message.kind === "user" && (
            <DeliveryMark
              message={message}
              personName={personName}
              stageThread={stageThread}
              ownMessage={isSignedInUser(message.writtenBy, signedInUserId)}
            />
          )}
        </div>
      ))}
    </TurnFrame>
  );
}

/**
 * The images a user message carried, as thumbnails opening the viewer, which steps through them;
 * one removed since shows so in its place.
 */
function SentImages({
  images,
  writer,
  at,
}: {
  readonly images: readonly MessageImage[];
  readonly writer: string;
  readonly at: string;
}): ReactNode {
  const [viewing, setViewing] = useState<number>();
  const viewed: ViewedImage[] = images.map(({ attachmentId, name }) => ({
    image: { kind: "message-image", id: attachmentId, name, writer, at },
    roundName: undefined,
  }));
  return (
    <div className="message-images attachment-thumbnails">
      {images.map((image, index) => (
        <ImageThumbnail
          key={image.attachmentId}
          image={{ id: image.attachmentId, name: image.name }}
          mayBeRemoved
          onView={() => setViewing(index)}
        />
      ))}
      {viewing !== undefined && (
        <AttachmentViewer
          images={viewed}
          index={viewing}
          onStep={setViewing}
          onClose={() => setViewing(undefined)}
        />
      )}
    </div>
  );
}

/**
 * A message that ran a skill ("/<skill> [input]", spec §2.4): marked as a skill command, with the
 * skill's name and what was written after it.
 */
function SkillCommandText({
  skill,
  text,
}: {
  readonly skill: string;
  readonly text: string;
}): ReactNode {
  const input = skillCommandInput(text);
  return (
    <div className="message-text skill-command-message">
      <p className="skill-command-head">
        <Badge tone="accent" size="sm">
          Skill command
        </Badge>
        <span className="skill-command-name">/{skill}</span>
      </p>
      {input !== "" && <MarkdownText text={input} />}
    </div>
  );
}

/** What follows a command's first word, its input. */
function skillCommandInput(text: string): string {
  return /^\s*\S+\s*([\s\S]*)$/.exec(text)?.[1]?.trim() ?? "";
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
  answering,
  handoverNoteReader,
}: {
  readonly message: Extract<MessageGroup, { kind: "alone" }>["message"];
  readonly personName: string;
  /** The person is answering now, which a Decision answered inline in a chat waits for. */
  readonly answering: boolean;
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
    case "stage-context-limit":
      return <div className="message-office">{stageContextLimitWords(message)}</div>;
    case "stage-session-restarted":
      return <BriefFold brief={message.brief}>{stageSessionRestartedWords(message)}</BriefFold>;
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
    case "engine-switched":
      return (
        <div className="message-office">
          <Icon name="refresh-cw" size={12} />
          <span>{engineSwitchedWords(message)}</span>
        </div>
      );
    case "model-gave-way":
      return (
        <div className="message-office">
          <Icon name="info" size={12} />
          <span>
            {message.personName} works with {message.model} on {message.engineName}, which
            doesn&apos;t offer {message.notOffered}.
          </span>
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
      return (
        <DecisionInThread
          decision={message.decision}
          personName={personName}
          answering={answering}
        />
      );
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
  const words = formAnswerWords(message.decision, message.formAnswer);
  if (message.decision.answeredByTheOffice) {
    // The Office sends a call back to its caller with words of its own, its general comment.
    const sent = message.formAnswer.generalComment?.trim();
    return (
      <div className="message-office">
        <MarkdownText text={sent ? sent : words} inline />
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

const DELIVERY_ICONS: Readonly<Record<MessageDelivery, string>> = {
  waiting: "clock",
  delivered: "check",
  "not-delivered": "circle-x",
};

/**
 * Whether the user's message reached the person: one written while they answer, or a Stage runs,
 * lands at the next safe point (barge-in), unless the answer or the Stage ends first.
 */
function DeliveryMark({
  message,
  personName,
  stageThread,
  ownMessage,
}: {
  readonly message: UserMessage;
  readonly personName: string;
  readonly stageThread: boolean;
  /** The message is the signed-in user's, who alone may send it again. */
  readonly ownMessage: boolean;
}): ReactNode {
  const { delivery } = message;
  const { stopped, sendAgain } = useContext(StoppedMessagesContext);
  const offersSendAgain = stopped.get(message.id);
  const icon = DELIVERY_ICONS[delivery];
  const words =
    stopped.has(message.id) && delivery === "not-delivered"
      ? `Not delivered: you stopped ${personName}`
      : deliveryWords(delivery, personName, stageThread);
  return (
    <div className={`message-delivery ${delivery}`}>
      <Icon name={icon} size={12} />
      {words}
      {offersSendAgain === true && ownMessage && sendAgain && (
        <SendAgainButton message={message} sendAgain={sendAgain} />
      )}
    </div>
  );
}

/** Sends the same words and images again, as a new message; it goes once it has been taken. */
function SendAgainButton({
  message,
  sendAgain,
}: {
  readonly message: UserMessage;
  readonly sendAgain: SendAgain;
}): ReactNode {
  const [sending, setSending] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      iconLeft={<Icon name="rotate-ccw" size={12} />}
      loading={sending}
      onClick={() => {
        setSending(true);
        sendAgain(message)
          // A refusal is shown where the message box shows its own; the button stays to try again.
          .catch(() => undefined)
          .finally(() => setSending(false));
      }}
    >
      Send again
    </Button>
  );
}

function deliveryWords(
  delivery: MessageDelivery,
  personName: string,
  stageThread: boolean,
): string {
  switch (delivery) {
    case "waiting":
      return "Lands at the next safe point";
    case "delivered":
      return "Delivered";
    case "not-delivered":
      return stageThread
        ? "Not delivered: the Stage ended first"
        : `Not delivered: ${personName} finished first`;
  }
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
  const label = contextLabel(line, personName);
  if (line.brief === null) return <div className="message-office">{label}</div>;
  return <BriefFold brief={line.brief}>{label}</BriefFold>;
}

/** A session's Brief, read only once opened so a closed fold holds nothing but its label. */
function BriefFold({
  brief,
  children,
}: {
  readonly brief: string;
  /** What the line says before "Brief". */
  readonly children?: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="message-office message-brief"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {children}
        <span className="message-brief-toggle">
          <Icon name="chevron-down" size={12} />
          Brief
        </span>
      </summary>
      {open && (
        <div className="message-brief-text">
          <MarkdownText text={brief} />
        </div>
      )}
    </details>
  );
}
