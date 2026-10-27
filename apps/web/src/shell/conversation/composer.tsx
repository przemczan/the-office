import { Icon, IconButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { useMentions } from "./mention-picker.tsx";
import { MessageField } from "./message-field.tsx";

/**
 * Writes the next message, with the keys every message field has; `@` mentions a Task, an open
 * Decision or an Idea, which the person then reads.
 */
export function Composer({
  placeholder,
  busy,
  busyHint,
  onSend,
}: {
  readonly placeholder: string;
  /** A message can't be sent now; a draft can still be written. */
  readonly busy: boolean;
  /** Why it can't be sent, for the send button and an Enter pressed meanwhile. */
  readonly busyHint: string;
  /** Resolves once the message is taken; the draft is kept when it rejects. */
  readonly onSend: (text: string) => Promise<unknown>;
}): ReactNode {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const mentions = useMentions(draft, setDraft);
  const canSend = !busy && !sending && draft.trim() !== "";
  const send = async (): Promise<void> => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(mentions.linked(draft));
      setDraft("");
      mentions.clear();
    } catch {
      // The caller shows why; the draft stays to send again.
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="composer">
      {mentions.picker}
      <MessageField
        label="Message"
        rows={2}
        placeholder={placeholder}
        value={draft}
        onChange={setDraft}
        canSend={canSend}
        busyReason={busy ? busyHint : undefined}
        onSend={() => void send()}
        autoFocus
        onKeyDownFirst={mentions.onKeyDownFirst}
        onCaret={mentions.onCaret}
      />
      <IconButton
        icon={<Icon name="at-sign" size={16} />}
        label="Mention a Task, Decision or Idea"
        variant="ghost"
        onClick={mentions.start}
      />
      <IconButton
        icon={<Icon name="arrow-up" size={16} />}
        label={busy ? busyHint : "Send (Enter)"}
        variant="primary"
        disabled={!canSend}
        onClick={() => void send()}
      />
    </div>
  );
}
