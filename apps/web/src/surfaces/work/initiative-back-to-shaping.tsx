import { useQueryClient } from "@tanstack/react-query";
import type { Initiative, Task, TaskSummary } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { initiativeBackToShaping, taskQueries } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import type { RecordAction } from "./record-actions.tsx";
import { useInitiativeChange } from "./use-initiative-change.ts";

/** What Back to Shaping moves back: its Tasks not started yet, and its branches. */
export interface MovedBack {
  readonly tasks: number;
  readonly branches: number;
}

const MOVING_BACK: readonly Task["state"][] = ["backlog", "planning", "ready"];

export function movedBack(
  initiative: Initiative,
  initiativeTasks: readonly TaskSummary[],
): MovedBack {
  return {
    tasks: initiativeTasks.filter(({ state }) => MOVING_BACK.includes(state)).length,
    branches: initiative.branches.length,
  };
}

/** The window's line on the Tasks that go back to Shaping. */
export function movedBackTasksWords(tasks: number): string {
  if (tasks === 0) return "None of its Tasks is in Backlog, Planning or Ready, so none moves.";
  if (tasks === 1)
    return "1 Task goes back to Shaping, out of the queue, its Plan kept but Not confirmed.";
  return `${tasks} Tasks go back to Shaping, out of the queue, their Plans kept but Not confirmed.`;
}

/** The window's line on the branches removed. */
export function movedBackBranchesWords(branches: number): string {
  if (branches === 0) return "It has no branch to remove.";
  const projects = branches === 1 ? "1 Project" : `${branches} Projects`;
  return `The Initiative's branch is removed from ${projects}.`;
}

export const BACK_IN_SHAPING_WORDS =
  "Initiative back in Shaping. Its Tasks wait in Shaping until you confirm it again.";

/**
 * Back to Shaping, while the Initiative is active: the user's own way back (no Agent has it),
 * asking first in a window that says what moves back; a refusal's reasons show there.
 */
export function useBackToShapingAction(
  initiative: Initiative,
  initiativeTasks: readonly TaskSummary[],
): RecordAction | undefined {
  const [asking, setAsking] = useState(false);
  if (initiative.state !== "active") return undefined;
  return {
    key: "back-to-shaping",
    label: "Back to Shaping",
    icon: "undo-2",
    zone: "more",
    hint: "Make it shaping again, its Tasks not started yet back in Shaping and its branches removed",
    onSelect: () => setAsking(true),
    ...(asking && {
      dialog: (
        <BackToShapingDialog
          initiative={initiative}
          initiativeTasks={initiativeTasks}
          onClose={() => setAsking(false)}
        />
      ),
    }),
  };
}

function BackToShapingDialog({
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
  // Kept from the click on: the Tasks' own events land before the answer, and change the count.
  const [asked, setAsked] = useState<MovedBack>();
  const moving = asked ?? movedBack(initiative, initiativeTasks);
  const changing = useInitiativeChange(
    initiative,
    () => initiativeBackToShaping(initiative.id),
    () => void queryClient.invalidateQueries(taskQueries.list()),
  );
  const goBack = (): void => {
    setAsked(moving);
    changing.mutate(undefined, {
      onSuccess: () => {
        showToast(BACK_IN_SHAPING_WORDS);
        onClose();
      },
      onError: () => setAsked(undefined),
    });
  };
  return (
    <Dialog
      size="small"
      title={`Take ${initiative.name} back to Shaping?`}
      onClose={onClose}
      actions={
        <Button variant="primary" loading={changing.isPending} onClick={goBack}>
          Back to Shaping
        </Button>
      }
    >
      <div className="dialog-stack">
        {changing.error && (
          <RefusalAlert title="The Initiative can't go back to Shaping" error={changing.error} />
        )}
        <p className="dialog-text">{movedBackTasksWords(moving.tasks)}</p>
        <p className="dialog-text">{movedBackBranchesWords(moving.branches)}</p>
        <p className="dialog-text">
          Its Short name and Pipelines are kept, to change before you confirm it again.
        </p>
      </div>
    </Dialog>
  );
}
