import { Icon, IconButton, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";

/** Writes the next message: Enter sends it, Shift+Enter starts a new line. */
export function Composer({
  placeholder,
  busy,
  busyHint,
  onSend,
}: {
  readonly placeholder: string;
  /** A message can't be sent now; a draft can still be written. */
  readonly busy: boolean;
  /** Why it can't be sent, for the send button. */
  readonly busyHint: string;
  /** Resolves once the message is taken; the draft is kept when it rejects. */
  readonly onSend: (text: string) => Promise<unknown>;
}): ReactNode {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const canSend = !busy && !sending && draft.trim() !== "";
  const send = async (): Promise<void> => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(draft);
      setDraft("");
    } catch {
      // The caller shows why; the draft stays to send again.
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="composer">
      <Textarea
        aria-label="Message"
        rows={2}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
        autoFocus
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
