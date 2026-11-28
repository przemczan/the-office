import type { HeldCall } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { MarkdownText } from "../markdown-text.tsx";
import { inputEntries, type InputEntry } from "./held-call-input.ts";
import { SubjectLink } from "./office-action-proposal.tsx";

/**
 * A held call in words: the action, what it does, the record it acts on and its input as a labelled
 * list, with the call as sent kept behind a collapsed disclosure (spec §2.4).
 */
export function HeldCallCard({ heldCall }: { readonly heldCall: HeldCall }): ReactNode {
  const { action, description, subject, input, callAsSent } = heldCall;
  const entries = inputEntries(input, subject);
  return (
    <div className="held-call">
      <p className="held-call-action">{action}</p>
      {description && (
        <div className="held-call-description">
          <MarkdownText text={description} />
        </div>
      )}
      {subject && (
        <p className="proposal-note">
          On <SubjectLink subject={subject} />
        </p>
      )}
      {entries.length > 0 && <InputList entries={entries} />}
      <details className="held-call-raw">
        <summary>
          <Icon name="chevron-right" size={12} />
          Show the call as sent
        </summary>
        <pre>{JSON.stringify(callAsSent, null, 2)}</pre>
      </details>
    </div>
  );
}

function InputList({ entries }: { readonly entries: readonly InputEntry[] }): ReactNode {
  return (
    <ul className="held-call-input">
      {entries.map(({ label, value }) => (
        <li key={label}>
          {!/^\d+$/.test(label) && <span className="proposal-change-label">{label}</span>}
          {value.kind === "subject" && <SubjectLink subject={value.subject} />}
          {value.kind === "text" &&
            (value.long ? (
              <div className="held-call-block">
                <MarkdownText text={value.text} />
              </div>
            ) : (
              <span>{value.text}</span>
            ))}
          {value.kind === "list" && <InputList entries={value.entries} />}
        </li>
      ))}
    </ul>
  );
}
