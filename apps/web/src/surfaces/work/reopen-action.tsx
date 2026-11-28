import { useQuery } from "@tanstack/react-query";
import type { Task } from "@the-office/contracts";
import { useState } from "react";
import { taskQueries } from "../../api/work.ts";
import { ReopenTaskDialog } from "./reopen-task-dialog.tsx";
import type { RecordAction } from "./record-actions.tsx";
import { offeredOrWhy } from "./run-controls.tsx";

/**
 * Reopen… on a Dropped Task, with its window, disabled with why while the service doesn't offer
 * it (spec §2.4.5); none until its ways back are read.
 */
export function useReopenAction(task: Task): RecordAction | undefined {
  const dropped = task.state === "dropped";
  const waysBack = useQuery({ ...taskQueries.waysBack(task.id), enabled: dropped }).data;
  const [open, setOpen] = useState(false);
  if (!dropped || waysBack === undefined) return undefined;
  return {
    key: "reopen",
    label: "Reopen…",
    icon: "undo-2",
    tone: "go",
    ...offeredOrWhy(waysBack.reopen, "Bring the Task back to Backlog or Ready"),
    onSelect: () => setOpen(true),
    ...(open && {
      dialog: <ReopenTaskDialog task={task} waysBack={waysBack} onClose={() => setOpen(false)} />,
    }),
  };
}
