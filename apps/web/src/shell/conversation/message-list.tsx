import type { Message } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useEffect, useRef, type ReactNode } from "react";
import { contextLabel } from "./context-words.ts";

/**
 * The Office's log of a Thread (spec §2.4): the user's messages and the person's, what the person
 * did with tools, what was refused, and The Office's own lines, never shown as a person's.
 */
export function MessageList({
  messages,
  personName,
  answering,
}: {
  readonly messages: readonly Message[];
  readonly personName: string;
  /** The person is writing an answer now. */
  readonly answering: boolean;
}): ReactNode {
  const end = useRef<HTMLDivElement>(null);
  // What the list shows at its end: each new message, or the person starting to answer, scrolls to it.
  const lines = messages.length + (answering ? 1 : 0);
  useEffect(() => {
    if (lines > 0) end.current?.scrollIntoView({ block: "end" });
  }, [lines]);
  return (
    <div className="message-list" aria-live="polite">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} personName={personName} />
      ))}
      {answering && (
        <div className="message-answering">
          <Icon name="loader" size={14} />
          {personName} is answering…
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

function MessageItem({
  message,
  personName,
}: {
  readonly message: Message;
  readonly personName: string;
}): ReactNode {
  switch (message.kind) {
    case "user":
      return (
        <div className="message mine">
          <div className="message-by">You</div>
          <div className="message-text">{message.text}</div>
        </div>
      );
    case "person":
      return (
        <div className="message">
          <div className="message-by">{personName}</div>
          <div className="message-text">{message.text}</div>
        </div>
      );
    case "handover-note":
      return (
        <div className="message handover-note">
          <div className="message-by">
            <Icon name="sticky-note" size={12} />
            Handover note from {personName}
          </div>
          <div className="message-text">{message.text}</div>
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
      return <div className="message-office">{contextLabel(message, personName)}</div>;
    case "failure":
      return (
        <div className="message-line failed">
          <Icon name="circle-alert" size={12} />
          <span className="message-summary">{message.reason}</span>
        </div>
      );
  }
}
