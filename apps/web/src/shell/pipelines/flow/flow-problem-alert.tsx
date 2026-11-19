import type { StageProblem } from "@the-office/contracts";
import { Alert } from "@the-office/ui";
import type { ReactNode } from "react";
import { problemKey } from "./flow-pick.ts";

/**
 * The problems on what the panel shows, at its top: one by its words, more as "2 problems here"
 * over their list. Nothing without any.
 */
export function FlowProblemAlert({
  problems,
}: {
  readonly problems: readonly StageProblem[];
}): ReactNode {
  const [only] = problems;
  if (!only) return null;
  if (problems.length === 1) return <Alert tone="danger" title={only.text} />;
  return (
    <Alert tone="danger" title={`${problems.length} problems here`}>
      <ul className="refusal-reasons">
        {problems.map((problem) => (
          <li key={problemKey(problem)}>{problem.text}</li>
        ))}
      </ul>
    </Alert>
  );
}
