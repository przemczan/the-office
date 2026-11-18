import type { StageProblem } from "@the-office/contracts";
import { Alert, TextButton } from "@the-office/ui";
import type { ReactNode } from "react";
import { problemKey } from "./flow/flow-pick.ts";

/**
 * What the service's check found: problems, which hold Save, and warnings, which it saves anyway,
 * such as a Role nobody fills. Given `onPick`, each one on a Stage is a link that picks where it is
 * (docs/design/pipeline-flow.html, "Above the bar").
 */
export function StageCheckAlerts({
  problems,
  warnings,
  problemsTitle,
  onPick,
}: {
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
  /** The problems' heading: what can't be saved. */
  readonly problemsTitle: string;
  /** Picks where a problem is; without it, the problems are words only. */
  readonly onPick?: (problem: StageProblem) => void;
}): ReactNode {
  return (
    <>
      {problems.length > 0 && (
        <Alert tone="warning" title={problemsTitle}>
          <ProblemList label="Problems" problems={problems} onPick={onPick} />
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert tone="info" title="Worth a look, though it doesn't hold Save">
          <ProblemList label="Warnings" problems={warnings} onPick={onPick} />
        </Alert>
      )}
    </>
  );
}

function ProblemList({
  label,
  problems,
  onPick,
}: {
  readonly label: string;
  readonly problems: readonly StageProblem[];
  readonly onPick: ((problem: StageProblem) => void) | undefined;
}): ReactNode {
  return (
    <ul className="refusal-reasons" aria-label={label}>
      {problems.map((problem) => (
        <li key={problemKey(problem)}>
          {onPick && problem.stageKey !== null ? (
            <TextButton onClick={() => onPick(problem)}>{problem.text}</TextButton>
          ) : (
            problem.text
          )}
        </li>
      ))}
    </ul>
  );
}
