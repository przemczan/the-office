import { useQuery } from "@tanstack/react-query";
import type { TaskRestart, TaskStage, TaskSummary } from "@the-office/contracts";
import { Button, Dialog, Select, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { pipelineQueries } from "../../api/pipelines.ts";
import { restartTask } from "../../api/work.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useWayBack } from "./way-back-parts.tsx";

/**
 * Restart from… a Task the user paused or stopped: any Stage of its Pipeline, later ones too, the
 * held Stage picked at first, with optional feedback. Feedback written is unsaved input.
 */
export function RestartTaskDialog({
  task,
  onClose,
}: {
  readonly task: TaskSummary;
  readonly onClose: () => void;
}): ReactNode {
  const stages = useQuery(pipelineQueries.taskStages(task.id)).data?.stages;
  const [pickedKey, setPickedKey] = useState<string>();
  const [feedback, setFeedback] = useState("");
  const stageKey = pickedKey ?? (stages ? heldStageKey(stages) : undefined);
  const stageName = (key: string): string =>
    stages?.find(({ stage }) => stage.key === key)?.stage.name ?? key;
  const restarting = useWayBack(
    task.id,
    (restart: TaskRestart) => restartTask(task.id, restart),
    (restart) => `Restarted from ${stageName(restart.stageKey)}.`,
    onClose,
  );
  const written = feedback.trim();
  return (
    <Dialog
      size="small"
      title={`Restart ${task.title} from…`}
      unsavedChanges={written !== ""}
      onClose={onClose}
      actions={
        <Button
          variant="primary"
          loading={restarting.isPending}
          disabled={stageKey === undefined}
          title={stageKey === undefined ? "Its Stages are still being read" : undefined}
          onClick={() => {
            if (stageKey === undefined) return;
            restarting.mutate(written === "" ? { stageKey } : { stageKey, feedback: written });
          }}
        >
          Restart
        </Button>
      }
    >
      <div className="dialog-stack">
        {restarting.error && (
          <RefusalAlert title="The Task can't be restarted" error={restarting.error} />
        )}
        <p className="dialog-text">
          The held run ends, and the uncommitted edits Pause kept are discarded. The Task goes on
          from the Stage picked, In progress.
        </p>
        <Select
          label="Restart from"
          value={stageKey ?? ""}
          disabled={!stages}
          options={(stages ?? []).map(({ stage }) => ({ value: stage.key, label: stage.name }))}
          onChange={setPickedKey}
        />
        <Textarea
          label="Feedback"
          hint="Optional. The Stage's run is briefed with it."
          rows={3}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
        />
      </div>
    </Dialog>
  );
}

/** The Stage the Task is held at, paused or stopped; else the first. */
function heldStageKey(stages: readonly TaskStage[]): string | undefined {
  const held = stages.find(({ state }) => state === "paused" || state === "stopped");
  return (held ?? stages[0])?.stage.key;
}
