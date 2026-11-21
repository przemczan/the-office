import { Link } from "@tanstack/react-router";
import { Alert } from "@the-office/ui";
import type { ReactNode } from "react";
import { connectRefusalOf, connectRefusalWords } from "../../api/devices.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { CONNECT_REFUSED } from "./device-words.ts";

/**
 * A refused connect or pairing (spec screens/task-page.md, "Devices"): "<device> is connected to
 * <Task>. Disconnect it there first." with the Task linked, or each reason as the service words it.
 */
export function ConnectRefused({
  error,
  deviceName,
}: {
  readonly error: Error;
  readonly deviceName: string;
}): ReactNode {
  const refusal = connectRefusalOf(error);
  if (refusal === undefined) return <RefusalAlert title={CONNECT_REFUSED} error={error} />;
  const words = connectRefusalWords(refusal, deviceName);
  return (
    <Alert tone="danger" title={CONNECT_REFUSED}>
      {words.kind === "other-task" ? (
        <p className="devices-refusal">
          {words.before}
          <Link to="/tasks/$taskId" params={{ taskId: words.task.id }}>
            {words.task.title}
          </Link>
          {words.after}
        </p>
      ) : (
        <ul className="refusal-reasons">
          {words.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
