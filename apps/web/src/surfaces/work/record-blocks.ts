import { useNavigate } from "@tanstack/react-router";
import { openFold } from "./record-folds.ts";

/** The Overview's blocks that Before Ready leads to, by their fold's name. */
export type PartBlock = "plan" | "definition-of-done";

/** Each block's element, for a link to land on; one Task's page shows at a time. */
export function recordBlockElementId(block: PartBlock): string {
  return `record-block-${block}`;
}

/**
 * Leads to a block of the Overview: its tab shown, its fold opened and the block brought into view,
 * with focus on its head.
 */
export function useShowRecordBlock(taskId: string): (block: PartBlock) => Promise<void> {
  const navigate = useNavigate({ from: "/tasks/$taskId" });
  return async (block) => {
    openFold({ kind: "task", id: taskId }, block);
    await navigate({
      search: ({ recordTab: _shown, ...search }) => search,
      resetScroll: false,
    });
    // The Overview renders on the next frame when another tab was shown.
    requestAnimationFrame(() => {
      const element = document.getElementById(recordBlockElementId(block));
      element?.scrollIntoView({ block: "start" });
      element?.querySelector("button")?.focus({ preventScroll: true });
    });
  };
}
