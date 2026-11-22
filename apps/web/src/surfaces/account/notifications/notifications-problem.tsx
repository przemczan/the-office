import type { ReactNode } from "react";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";

/** What went wrong reading or saving the user's Notifications settings, in the card it belongs to. */
export function NotificationsProblem({
  title,
  error,
}: {
  readonly title: string;
  readonly error: Error | null;
}): ReactNode {
  return (
    error && (
      <div className="notifications-banner">
        <RefusalAlert title={title} error={error} />
      </div>
    )
  );
}
