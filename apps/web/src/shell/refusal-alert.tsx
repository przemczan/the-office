import { Alert } from "@the-office/ui";
import type { ReactNode } from "react";
import { ApiError } from "../api/api-client.ts";

/** Every reason the service refused a change, or what went wrong on the way. */
export function RefusalAlert({
  title,
  error,
}: {
  readonly title: string;
  readonly error: Error;
}): ReactNode {
  const reasons = error instanceof ApiError ? error.reasons : [error.message];
  return (
    <Alert tone="danger" title={title}>
      <ul className="refusal-reasons">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </Alert>
  );
}
