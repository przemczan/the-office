import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Idea, Initiative, Project, ProjectMove } from "@the-office/contracts";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { ideaQueries, initiativeQueries } from "../../api/work.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { dayAndClockOf } from "../../shell/time.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold, type FoldedRecord } from "./record-folds.ts";

/** Where a record came from, as `useOrigin` finds it. */
export interface Origin {
  readonly idea: Idea | undefined;
  readonly initiative: Initiative | undefined;
  readonly projectMoves: readonly ProjectMove[];
  readonly projects: readonly Project[] | undefined;
  /** A Project's name, or its id while the Projects load. */
  readonly nameOf: (projectId: string) => string;
  /** The folded line. */
  readonly summary: string;
}

/**
 * Where a record came from: the Idea it was shaped from, and for a Task the Initiative it is part
 * of and the Projects it moved from. Null when there is none of them.
 */
export function useOrigin(
  ideaId: string | null,
  initiativeId: string | null = null,
  projectMoves: readonly ProjectMove[] = [],
): Origin | null {
  const idea = useQuery({ ...ideaQueries.one(ideaId ?? ""), enabled: ideaId !== null }).data;
  const initiative = useQuery({
    ...initiativeQueries.one(initiativeId ?? ""),
    enabled: initiativeId !== null,
  }).data;
  const projects = useQuery({
    ...projectQueries.list(),
    enabled: ideaId !== null || projectMoves.length > 0,
  }).data;
  if (!idea && !initiative && projectMoves.length === 0) return null;
  const nameOf = (projectId: string) =>
    projects?.find(({ id }) => id === projectId)?.name ?? projectId;
  const lastMove = projectMoves.at(-1);
  const summary = [
    ...(idea ? [`Idea: ${idea.title}`] : []),
    ...(initiative ? [`Initiative: ${initiative.name}`] : []),
    ...(lastMove ? [`Moved from ${nameOf(lastMove.from)}`] : []),
  ].join(" · ");
  return { idea, initiative, projectMoves, projects, nameOf, summary };
}

/**
 * The Origin's lines: the Idea, linked to it on the Ideas page with the Project it was captured
 * in, the Initiative by its name now, and each move between Projects.
 */
export function OriginDetails({ origin }: { readonly origin: Origin }): ReactNode {
  const { idea, initiative, projectMoves, projects, nameOf } = origin;
  return (
    <>
      {idea && (
        <>
          <p className="task-plan">
            <Link to="/work/ideas" search={{ idea: idea.id }}>
              {idea.title}
            </Link>{" "}
            <ProjectChip projectId={idea.projectId} projects={projects} />{" "}
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
    </>
  );
}

/** The Origin as a block of its own, on the Initiative page. */
export function OriginBlock({
  record,
  ideaId,
}: {
  readonly record: FoldedRecord;
  readonly ideaId: string | null;
}): ReactNode {
  const fold = useFold(record, "origin", false);
  const origin = useOrigin(ideaId);
  if (!origin) return null;
  return (
    <RecordFold fold={fold} icon="lightbulb" title="Origin" summary={origin.summary}>
      <OriginDetails origin={origin} />
    </RecordFold>
  );
}
