import type { TaskSummary, TaskWaysBack } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { startTaskOver } from "../../api/work.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { EARLIER_RUNS_STAY, ResetBranchField, useWayBack } from "./way-back-parts.tsx";

/**
 * Start over a Task the user paused or stopped: it goes to Ready, its branch reset to the base
 * at first when it had started. A small confirmation: the reset's checkbox is no unsaved input.
 */
export function StartOverDialog({
  task,
  waysBack,
  onClose,
}: {
  readonly task: TaskSummary;
  readonly waysBack: TaskWaysBack;
  readonly onClose: () => void;
}): ReactNode {
  const [resetBranch, setResetBranch] = useState(true);
  const startingOver = useWayBack(
    task.id,
    (reset: boolean) => startTaskOver(task.id, reset),
    () => "Started over: the Task is Ready.",
    onClose,
  );
  return (
    <Dialog
      size="small"
      title={`Start ${task.title} over?`}
      unsavedChanges={false}
      onClose={onClose}
      actions={
        <Button
          variant="primary"
          loading={startingOver.isPending}
          onClick={() => startingOver.mutate(waysBack.started && resetBranch)}
        >
          Start over
        </Button>
      }
    >
      <div className="dialog-stack">
        {startingOver.error && (
          <RefusalAlert title="The Task can't be started over" error={startingOver.error} />
        )}
        <p className="dialog-text">
          The held run ends and the Task goes to Ready, to start again from its first Stage.{" "}
          {EARLIER_RUNS_STAY}
        </p>
        {waysBack.started && (
          <ResetBranchField
            resetTo={waysBack.resetTo}
            checked={resetBranch}
            disabled={startingOver.isPending}
            onChange={setResetBranch}
          />
        )}
      </div>
    </Dialog>
  );
}
