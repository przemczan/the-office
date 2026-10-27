import { useQuery } from "@tanstack/react-query";
import {
  CAPTURE_IDEA_TOOL,
  DECISION_TOOLS,
  POST_LINK_CARD_TOOL,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_ROLE_TOOL,
  SHOW_OFFICE_STATUS_TOOL,
  type Decision,
  type DecisionAnswer,
  type Message,
  type MessageDelivery,
} from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { roleName } from "../person-name.ts";
import { contextLabel } from "./context-words.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { DecisionCard } from "./decision-card.tsx";
import { IdeaCard } from "./idea-card.tsx";
import { LinkCard } from "./link-card.tsx";
import { OfficeStatusCard } from "./office-status-card.tsx";
import { ProposalCard } from "./proposal-card.tsx";

/**
 * The Office's log of a Thread (spec §2.4): the user's messages and the person's, what the person
 * did with tools, what was refused, and The Office's own lines, never shown as a person's.
 */
export function MessageList({
  messages,
  personName,
  answering,
  stageThread,
}: {
  readonly messages: readonly Message[];
  readonly personName: string;
  /** The person is writing an answer now. */
  readonly answering: boolean;
  /** The user's messages say whether they reached the person, as one written while the Stage runs waits. */
  readonly stageThread: boolean;
}): ReactNode {
  const list = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const shownLinkedTo = useRef(false);
  // What the list shows at its end: each new message, or the person starting to answer, scrolls to it.
  // A Decision's link opens the list at its card instead, once.
  const lines = messages.length + (answering ? 1 : 0);
  useEffect(() => {
    if (lines === 0) return;
    const linkedTo = shownLinkedTo.current
      ? null
      : list.current?.querySelector(".decision-card.linked-to");
    if (linkedTo) {
      shownLinkedTo.current = true;
      linkedTo.scrollIntoView({ block: "center" });
    } else {
      end.current?.scrollIntoView({ block: "end" });
    }
  }, [lines]);
  return (
    <div className="message-list" aria-live="polite" ref={list}>
      {messages.filter(shown).map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          personName={personName}
          answering={answering}
          stageThread={stageThread}
        />
      ))}
      {answering && (
        <div className="message-answering" role="status">
          <Icon name="loader" size={14} />
          {personName} is working…
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

/** A card shows its tool's call, so the call's activity line is left out. */
const TOOLS_SHOWN_AS_CARDS: readonly string[] = [
  ...DECISION_TOOLS,
  PROPOSE_ROLE_TOOL,
  PROPOSE_OFFICE_SETTING_TOOL,
  POST_LINK_CARD_TOOL,
  CAPTURE_IDEA_TOOL,
  SHOW_OFFICE_STATUS_TOOL,
];

function shown(message: Message): boolean {
  return message.kind !== "tool-activity" || !TOOLS_SHOWN_AS_CARDS.includes(message.tool);
}

function MessageItem({
  message,
  personName,
  answering,
  stageThread,
}: {
  readonly message: Message;
  readonly personName: string;
  readonly answering: boolean;
  readonly stageThread: boolean;
}): ReactNode {
  switch (message.kind) {
    case "user":
      return (
        <div className="message mine">
          <div className="message-by">
            {message.handoverNoteFrom === null ? (
              "You"
            ) : (
              <HandoverNoteFrom roleKey={message.handoverNoteFrom} />
            )}
          </div>
          <div className="message-text">
            <MarkdownText text={message.text} />
          </div>
          {stageThread && <DeliveryMark delivery={message.delivery} />}
        </div>
      );
    case "person":
      return (
        <div className="message">
          <div className="message-by">{personName}</div>
          <div className="message-text">
            <MarkdownText text={message.text} />
          </div>
        </div>
      );
    case "handover-note":
      return (
        <div className="message handover-note">
          <div className="message-by">
            <Icon name="sticky-note" size={12} />
            Handover note from {personName}
          </div>
          <div className="message-text">
            <MarkdownText text={message.text} />
          </div>
        </div>
      );
    case "tool-activity":
      return (
        <div className="message-line">
          <Icon name="wrench" size={12} />
          <span className="message-tool">{message.tool}</span>
          {message.summary !== "" && <span className="message-summary">{message.summary}</span>}
        </div>
      );
    case "refusal":
      return (
        <div className="message-line refused">
          <Icon name="shield-x" size={12} />
          <span className="message-tool">{message.tool} refused</span>
          <span className="message-summary">{message.reason}</span>
        </div>
      );
    case "context":
      return <ContextLine line={message} personName={personName} />;
    case "failure":
      return (
        <div className="message-line failed">
          <Icon name="circle-alert" size={12} />
          <span className="message-summary">{message.reason}</span>
        </div>
      );
    case "held":
      return (
        <div className="message-line held">
          <Icon name={message.heldBy === "pause" ? "pause" : "square"} size={12} />
          <span className="message-summary">{message.text}</span>
        </div>
      );
    case "decision":
      return (
        <DecisionCard
          decision={message.decision}
          personName={personName}
          answering={answering}
          followUps={!stageThread}
        />
      );
    case "decision-answer":
      return (
        <div className="message mine">
          <div className="message-by">You · answering the Decision</div>
          <div className="message-text">
            <MarkdownText text={answerWords(message.answer, message.decision)} />
          </div>
        </div>
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

/** The user's answer to a Decision in words: the chosen option's, or their own. */
function answerWords(answer: DecisionAnswer, { options }: Decision): string {
  return answer.kind === "option" ? (options[answer.option] ?? "") : answer.text;
}
