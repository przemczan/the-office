import { Alert } from "@the-office/ui";
import type { ReactNode } from "react";
import { ApiError } from "../api/api-client.ts";

/** Every reason the service refused a change, or what went wrong on the way. */
export function RefusalAlert({
  title,
  error,
  action,
}: {
  readonly title: string;
  readonly error: Error;
  /** A button on its right, such as Try again. */
  readonly action?: ReactNode;
}): ReactNode {
  const reasons = error instanceof ApiError ? error.reasons : [error.message];
  return (
    <Alert tone="danger" title={title} action={action}>
      <ul className="refusal-reasons">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </Alert>
  );
}
