import { Dialog, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { SubAgentsAndProcessesView } from "./sub-agents-and-processes-view.tsx";

/**
 * The view in a large window that keeps one height (spec 4.1), from the chat drawer and the Task
 * page; its bar says it is read-only, and Close is all it offers.
 */
export function SubAgentsAndProcessesWindow({
  threadId,
  personName,
  where,
  onClose,
}: {
  readonly threadId: string;
  readonly personName: string;
  /** Whose Thread it is, under the title. */
  readonly where: string;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      size="large"
      keepsHeight
      title={
        <span className="sub-agents-and-processes-window-title">
          Sub-agents and processes
          <span>{where}</span>
        </span>
      }
      actions={
        <span className="sub-agents-and-processes-read-only">
          <Icon name="lock" size={12} />
          Read-only: only the Agent can stop them
        </span>
      }
      onClose={onClose}
    >
      <div className="sub-agents-and-processes-window">
        <SubAgentsAndProcessesView threadId={threadId} personName={personName} />
      </div>
    </Dialog>
  );
}
