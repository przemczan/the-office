import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Idea, Project, ProjectMove } from "@the-office/contracts";
import type { ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { ideaQueries } from "../../api/work.ts";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { dayAndClockOf } from "../../shell/time.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold, type FoldedRecord } from "./record-folds.ts";

/** Where a record came from, as `useOrigin` finds it. */
export interface Origin {
  readonly idea: Idea | undefined;
  readonly projectMoves: readonly ProjectMove[];
  readonly projects: readonly Project[] | undefined;
  /** A Project's name, or its id while the Projects load. */
  readonly nameOf: (projectId: string) => string;
  /** The folded line. */
  readonly summary: string;
}

/**
 * Where a record came from: the Idea it was shaped from, and for a Task the Projects it moved from.
 * Null when there is none of them. A Task's Initiative has a section of its own, as it may change.
 */
export function useOrigin(
  ideaId: string | null,
  projectMoves: readonly ProjectMove[] = [],
): Origin | null {
  const idea = useQuery({ ...ideaQueries.one(ideaId ?? ""), enabled: ideaId !== null }).data;
  const projects = useQuery({
    ...projectQueries.list(),
    enabled: ideaId !== null || projectMoves.length > 0,
  }).data;
  if (!idea && projectMoves.length === 0) return null;
  const nameOf = (projectId: string) =>
    projects?.find(({ id }) => id === projectId)?.name ?? projectId;
  const lastMove = projectMoves.at(-1);
  const summary = [
    ...(idea ? [`Idea: ${idea.title}`] : []),
    ...(lastMove ? [`Moved from ${nameOf(lastMove.from)}`] : []),
  ].join(" · ");
  return { idea, projectMoves, projects, nameOf, summary };
}

/**
 * The Origin's lines: the Idea, linked to it on the Ideas page with the Project it was captured
 * in, and each move between Projects.
 */
export function OriginDetails({ origin }: { readonly origin: Origin }): ReactNode {
  const { idea, projectMoves, projects, nameOf } = origin;
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
