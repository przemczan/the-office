import { useQueryClient } from "@tanstack/react-query";
import type { Initiative, TaskSummary } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { dropInitiative, taskQueries } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import {
  droppedWithIt,
  droppedWords,
  dropTasksWords,
  type DroppedWithIt,
} from "./initiative-words.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";

/**
 * Dropping is the Initiative's exit, and every one of its Tasks not yet Done or Dropped goes with
 * it (spec 2.1), so the dialog says how many, and how many of them are started.
 */
export function DropInitiativeDialog({
  initiative,
  initiativeTasks,
  onClose,
}: {
  readonly initiative: Initiative;
  readonly initiativeTasks: readonly TaskSummary[];
  readonly onClose: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  // Kept from the click on: the Tasks' own events land before the answer, and drop the count.
  const [asked, setAsked] = useState<DroppedWithIt>();
  const withIt = asked ?? droppedWithIt(initiativeTasks);
  const dropping = useInitiativeChange(
    initiative,
    () => dropInitiative(initiative.id),
    () => void queryClient.invalidateQueries(taskQueries.list()),
  );
  const drop = (): void => {
    setAsked(withIt);
    dropping.mutate(undefined, {
      onSuccess: () => {
        showToast(droppedWords(withIt));
        onClose();
      },
      onError: () => setAsked(undefined),
    });
  };
  return (
    <Dialog
      size="small"
      title={`Drop ${initiative.name}?`}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={dropping.isPending} onClick={drop}>
          Drop the Initiative
        </Button>
      }
    >
      <div className="dialog-stack">
        {dropping.error && (
          <RefusalAlert title="The Initiative can't be dropped" error={dropping.error} />
        )}
        <p className="dialog-text">{dropTasksWords(withIt)}</p>
        <p className="dialog-text">
          {initiative.branches.length > 0 && "Its branches are kept. "}
          It moves to Done as dropped and stays readable there; a dropped Initiative can't be picked
          up again.
        </p>
      </div>
    </Dialog>
  );
}
