import type { StageProblem } from "@the-office/contracts";
import { Alert } from "@the-office/ui";
import type { ReactNode } from "react";

/**
 * What the service's check found: problems, which hold Save, and flags, which it saves anyway, such
 * as a Role nobody fills.
 */
export function StageCheckAlerts({
  problems,
  flags,
  problemsTitle,
}: {
  readonly problems: readonly StageProblem[];
  readonly flags: readonly StageProblem[];
  /** The problems' heading: what can't be saved. */
  readonly problemsTitle: string;
}): ReactNode {
  return (
    <>
      {problems.length > 0 && (
        <Alert tone="warning" title={problemsTitle}>
          <ul className="refusal-reasons" aria-label="Problems">
            {problems.map(({ text }) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Alert>
      )}
      {flags.length > 0 && (
        <Alert tone="info" title="This can be saved, though nobody works these Stages yet">
          <ul className="refusal-reasons" aria-label="Flags">
            {flags.map(({ text }) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}
