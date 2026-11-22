import { isOffBoardTask, type TaskMadeFor } from "@the-office/contracts";
import { Badge } from "@the-office/ui";
import type { ReactNode } from "react";

/** The badge's words, wherever an Off-board Task shows beside other Tasks (spec §2.1). */
export const OFF_BOARD_TASK = "Off-board Task";

/** The Off-board Task badge, or nothing for any other Task, by what The Office made it for. */
export function OffBoardTaskBadge({
  madeFor,
}: {
  readonly madeFor: TaskMadeFor | null;
}): ReactNode {
  if (!isOffBoardTask({ madeFor })) return null;
  return (
    <Badge tone="neutral" size="sm">
      {OFF_BOARD_TASK}
    </Badge>
  );
}
