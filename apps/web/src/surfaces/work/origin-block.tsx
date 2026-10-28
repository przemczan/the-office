import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ideaQueries } from "../../api/work.ts";
import { dayAndClockOf } from "../../shell/time.ts";
import { RecordBlock } from "./record-block.tsx";

/** The Idea a Task or an Initiative was shaped from, linked to it on the Ideas page. */
export function OriginBlock({ ideaId }: { readonly ideaId: string }): ReactNode {
  const idea = useQuery(ideaQueries.one(ideaId));
  if (!idea.data) return null;
  return (
    <RecordBlock icon="lightbulb" title="Started from the Idea">
      <p className="task-plan">
        <Link to="/work/ideas" search={{ idea: ideaId }}>
          {idea.data.title}
        </Link>{" "}
        <span className="task-quiet">· captured {dayAndClockOf(idea.data.capturedAt)}</span>
      </p>
      {idea.data.notes !== "" && <p className="task-quiet">{idea.data.notes}</p>}
    </RecordBlock>
  );
}
