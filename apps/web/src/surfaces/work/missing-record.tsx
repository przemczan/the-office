import { Link } from "@tanstack/react-router";
import { EmptyState } from "@the-office/ui";
import type { ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";

/** A Task's or an Initiative's page when it can't be read: gone, or the service refused. */
export function MissingRecord({
  error,
  kind,
}: {
  readonly error: Error;
  readonly kind: "Task" | "Initiative";
}): ReactNode {
  const gone = error instanceof ApiError && error.status === 404;
  return (
    <div className="task-page">
      <EmptyState
        icon={gone ? "file-x" : "circle-alert"}
        title={gone ? error.message : `The ${kind} can't be shown.`}
        description={gone ? undefined : error.message}
        action={<Link to="/work">Back to Work</Link>}
      />
    </div>
  );
}
