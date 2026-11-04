import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ideaQueries, initiativeQueries } from "../../api/work.ts";
import { dayAndClockOf } from "../../shell/time.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold, type FoldedRecord } from "./record-folds.ts";

/**
 * Where a record came from: the Idea it was shaped from, linked to it on the Ideas page, and for a
 * Task the Initiative it is part of, by its name now.
 */
export function OriginBlock({
  record,
  ideaId,
  initiativeId = null,
}: {
  readonly record: FoldedRecord;
  readonly ideaId: string | null;
  readonly initiativeId?: string | null;
}): ReactNode {
  const fold = useFold(record, "origin", false);
  const idea = useQuery({ ...ideaQueries.one(ideaId ?? ""), enabled: ideaId !== null }).data;
  const initiative = useQuery({
    ...initiativeQueries.one(initiativeId ?? ""),
    enabled: initiativeId !== null,
  }).data;
  if (!idea && !initiative) return null;
  const summary = [
    ...(idea ? [`Idea: ${idea.title}`] : []),
    ...(initiative ? [`Initiative: ${initiative.name}`] : []),
  ];
  return (
    <RecordFold fold={fold} icon="lightbulb" title="Origin" summary={summary.join(" · ")}>
      {idea && (
        <>
          <p className="task-plan">
            <Link to="/work/ideas" search={{ idea: idea.id }}>
              {idea.title}
            </Link>{" "}
            <span className="task-quiet">· captured {dayAndClockOf(idea.capturedAt)}</span>
          </p>
          {idea.notes !== "" && <p className="task-quiet">{idea.notes}</p>}
        </>
      )}
      {initiative && (
        <p className="task-plan">
          <Link to="/work/initiatives/$initiativeId" params={{ initiativeId: initiative.id }}>
            {initiative.name}
          </Link>{" "}
          <span className="task-quiet">· Initiative</span>
        </p>
      )}
    </RecordFold>
  );
}
