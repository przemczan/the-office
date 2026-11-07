import type { Task } from "@the-office/contracts";
import type { ReactNode } from "react";
import { RecordMention } from "../../shell/record-mention.tsx";

/** The way to the Initiative a Task in Shaping waits for. */
export function ItsInitiativeLink({ task }: { readonly task: Task }): ReactNode {
  if (task.initiativeId === null) return null;
  return (
    <p className="task-quiet">
      <RecordMention
        link={{ kind: "initiative", initiativeId: task.initiativeId }}
        written="Initiative"
      />
    </p>
  );
}
