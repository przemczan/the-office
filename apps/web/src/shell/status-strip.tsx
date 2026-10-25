import type { ReactNode } from "react";
import { useEventStreamStatus } from "../api/event-stream-provider.tsx";

/**
 * The strip under the top bar, where the Office-wide figures go (task 16). Until then it says only
 * when the web has lost the service and is reconnecting; while connected it shows nothing.
 */
export function StatusStrip(): ReactNode {
  const reconnecting = useEventStreamStatus() === "reconnecting";
  return (
    <div className="shell-strip" role="status">
      {reconnecting && (
        <span className="shell-strip-stat">
          <span className="shell-dot reconnecting" />
          Reconnecting to The Office…
        </span>
      )}
    </div>
  );
}
