import type { StartOverTo, TaskStartOver, TaskSummary, TaskWaysBack } from "@the-office/contracts";
import { Button, Dialog, Field, RadioList } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { startTaskOver } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import {
  EARLIER_RUNS_STAY,
  notResetWhy,
  ResetBranchField,
  resetsBranch,
  useWayBack,
} from "./way-back-parts.tsx";

const STARTED_OVER_WORDS: Readonly<Record<StartOverTo, string>> = {
  backlog: "Started over: the Task is in Backlog, to plan again.",
  ready: "Started over: the Task is Ready.",
};

const START_OVER_TO_WORDS: Readonly<Record<StartOverTo, string>> = {
  backlog:
    "Its Plan, Definition of Done and Pipeline stay but go back to Not confirmed, to plan again, and its Stages edited for this Task are dropped.",
  ready:
    "Its Plan, Definition of Done and Pipeline stay confirmed, to start again from its first Stage.",
};

/**
 * Start over a Task the user paused or stopped: it goes to Ready or Backlog, its branch reset to
 * the base at first when it had started and may be. A small confirmation: its choices are no
 * unsaved input.
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
  const name = useId();
  const [to, setTo] = useState<StartOverTo>("ready");
  const [resetBranch, setResetBranch] = useState(waysBack.resetBranch.offered);
  const startingOver = useWayBack(
    task.id,
    (startOver: TaskStartOver) => startTaskOver(task.id, startOver),
    (startOver) => STARTED_OVER_WORDS[startOver.to],
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
          onClick={() =>
            startingOver.mutate({ to, resetBranch: resetsBranch(waysBack, resetBranch) })
          }
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
          The held run ends and the Task goes back, not queued. {EARLIER_RUNS_STAY}
        </p>
        <Field label="Start over to">
          <RadioList
            label="Start over to"
            name={name}
            options={[
              { value: "ready", label: "To Ready" },
              { value: "backlog", label: "To Backlog" },
            ]}
            value={to}
            disabled={startingOver.isPending}
            onChange={(picked) => setTo(picked === "backlog" ? "backlog" : "ready")}
          />
          <p className="dialog-hint">{START_OVER_TO_WORDS[to]}</p>
        </Field>
        {waysBack.started && (
          <ResetBranchField
            resetTo={waysBack.resetTo}
            checked={resetBranch}
            notReset={notResetWhy(waysBack)}
            disabled={startingOver.isPending}
            onChange={setResetBranch}
          />
        )}
      </div>
    </Dialog>
  );
}
