import type { StageProblem } from "@the-office/contracts";
import { Alert } from "@the-office/ui";
import type { ReactNode } from "react";

/**
 * What the service's check found: problems, which hold Save, and warnings, which it saves anyway,
 * such as a Role nobody fills.
 */
export function StageCheckAlerts({
  problems,
  warnings,
  problemsTitle,
}: {
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
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
      {warnings.length > 0 && (
        <Alert tone="info" title="This can be saved, though worth a look first">
          <ul className="refusal-reasons" aria-label="Warnings">
            {warnings.map(({ text }) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}
