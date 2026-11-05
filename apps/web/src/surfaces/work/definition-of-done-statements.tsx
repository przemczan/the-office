import { Badge, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { reportedMetCount } from "../../shell/work/work-words.ts";

/**
 * The statements by their numbers. Once the Task has started, each Reported met is marked: `met` is
 * the service's answer, the walk's own rule, and is never worked out here.
 */
export function DefinitionOfDoneStatements({
  statements,
  met,
}: {
  readonly statements: readonly string[];
  /** The numbers Reported met; undefined before the Task starts. */
  readonly met: readonly number[] | undefined;
}): ReactNode {
  return (
    <ol className="task-dod">
      {statements.map((statement, index) => (
        <li key={statement}>
          {met?.includes(index + 1) && (
            <span className="task-dod-met" role="img" aria-label="Reported met">
              <Icon name="check" size={12} />
            </span>
          )}
          {statement}
        </li>
      ))}
    </ol>
  );
}

/** How many statements are Reported met, on the fold's side where a planned Task shows Confirmed. */
export function ReportedMetBadge({
  statements,
  met,
}: {
  readonly statements: readonly string[];
  readonly met: readonly number[];
}): ReactNode {
  const count = reportedMetCount(statements, met);
  if (count === statements.length) return <Badge tone="success">All Reported met</Badge>;
  return (
    <Badge>
      {count} / {statements.length}
    </Badge>
  );
}
