import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ProjectMove } from "@the-office/contracts";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { ideaQueries, initiativeQueries } from "../../api/work.ts";
import { dayAndClockOf } from "../../shell/time.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold, type FoldedRecord } from "./record-folds.ts";

/**
 * Where a record came from: the Idea it was shaped from, linked to it on the Ideas page, and for a
 * Task the Initiative it is part of, by its name now, and the Projects it moved from.
 */
export function OriginBlock({
  record,
  ideaId,
  initiativeId = null,
  projectMoves = [],
}: {
  readonly record: FoldedRecord;
  readonly ideaId: string | null;
  readonly initiativeId?: string | null;
  readonly projectMoves?: readonly ProjectMove[];
}): ReactNode {
  const fold = useFold(record, "origin", false);
  const idea = useQuery({ ...ideaQueries.one(ideaId ?? ""), enabled: ideaId !== null }).data;
  const initiative = useQuery({
    ...initiativeQueries.one(initiativeId ?? ""),
    enabled: initiativeId !== null,
  }).data;
  const projects = useQuery({ ...projectQueries.list(), enabled: projectMoves.length > 0 }).data;
  if (!idea && !initiative && projectMoves.length === 0) return null;
  const nameOf = (projectId: string) =>
    projects?.find(({ id }) => id === projectId)?.name ?? projectId;
  const lastMove = projectMoves.at(-1);
  const summary = [
    ...(idea ? [`Idea: ${idea.title}`] : []),
    ...(initiative ? [`Initiative: ${initiative.name}`] : []),
    ...(lastMove ? [`Moved from ${nameOf(lastMove.from)}`] : []),
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
      {projectMoves.map((move) => (
        <p key={move.at} className="task-plan">
          Moved from {nameOf(move.from)} to {nameOf(move.to)}{" "}
          <span className="task-quiet">· {dayAndClockOf(move.at)}</span>
        </p>
      ))}
    </RecordFold>
  );
}
