import type { ReopenTo, TaskReopen, TaskSummary, TaskWaysBack } from "@the-office/contracts";
import { Button, Dialog, Field, RadioList } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { reopenTask } from "../../api/work.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { EARLIER_RUNS_STAY, ResetBranchField, useWayBack } from "./way-back-parts.tsx";

const REOPENED_WORDS: Readonly<Record<ReopenTo, string>> = {
  backlog: "Reopened to Backlog.",
  ready: "Reopened to Ready.",
};

/**
 * Reopen… a Dropped Task, to Backlog or to Ready (To Ready only while it is offered); one that had
 * started is started over, its branch reset to the base at first.
 */
export function ReopenTaskDialog({
  task,
  waysBack,
  onClose,
}: {
  readonly task: TaskSummary;
  readonly waysBack: TaskWaysBack;
  readonly onClose: () => void;
}): ReactNode {
  const name = useId();
  const [to, setTo] = useState<ReopenTo>("backlog");
  const [resetBranch, setResetBranch] = useState(true);
  const reopening = useWayBack(
    task.id,
    (reopen: TaskReopen) => reopenTask(task.id, reopen),
    (reopen) => REOPENED_WORDS[reopen.to],
    onClose,
  );
  const readyWhy = waysBack.reopenToReady.offered
    ? undefined
    : (waysBack.reopenToReady.why ?? "It can't go to Ready now");
  return (
    <Dialog
      size="small"
      title={`Reopen ${task.title}?`}
      unsavedChanges={false}
      onClose={onClose}
      actions={
        <Button
          variant="primary"
          loading={reopening.isPending}
          onClick={() => reopening.mutate({ to, resetBranch: waysBack.started && resetBranch })}
        >
          Reopen the Task
        </Button>
      }
    >
      <div className="dialog-stack">
        {reopening.error && (
          <RefusalAlert title="The Task can't be reopened" error={reopening.error} />
        )}
        <p className="dialog-text">
          {waysBack.started
            ? `It comes back on the board and starts over. ${EARLIER_RUNS_STAY}`
            : "It comes back on the board, to be picked up again."}
        </p>
        <Field label="Reopen to">
          <RadioList
            label="Reopen to"
            name={name}
            options={[
              { value: "backlog", label: "To Backlog" },
              {
                value: "ready",
                label: "To Ready",
                ...(readyWhy !== undefined && { disabledWhy: readyWhy }),
              },
            ]}
            value={to}
            disabled={reopening.isPending}
            onChange={(picked) => setTo(picked === "ready" ? "ready" : "backlog")}
          />
          {readyWhy !== undefined && <p className="dialog-hint">To Ready: {readyWhy}</p>}
        </Field>
        {waysBack.started && (
          <ResetBranchField
            resetTo={waysBack.resetTo}
            checked={resetBranch}
            disabled={reopening.isPending}
            onChange={setResetBranch}
          />
        )}
      </div>
    </Dialog>
  );
}
