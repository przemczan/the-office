import type { Task } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeCommitMessage } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { PartEditor } from "./part-editor.tsx";
import { useRecordChange } from "./planning-parts.tsx";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";

export const NO_COMMIT_MESSAGE =
  "None written: Publish uses the Task's title with a short summary below it.";
export const COMMIT_MESSAGE_PUBLISHED = "Published as one commit.";

/**
 * The Task's commit message (spec §2.3, "The Task's commit message"): the message of the one commit
 * Publish lands the Task as, which the Planner suggests and the Agent Stages update. The user edits
 * it until Publish lands it, or the Task is Done or Dropped; it shows the default while none is
 * written. Starts folded, as the Plan's detail.
 */
export function CommitMessageBlock({ task }: { readonly task: Task }): ReactNode {
  const changing = useRecordChange(task, (message: string) =>
    changeCommitMessage(task.id, message),
  );
  const [editing, setEditing] = useState(false);
  const published = task.commitMessagePublishedAt !== null;
  const editable = !published && task.state !== "done" && task.state !== "dropped";
  const fold = useFold({ kind: "task", id: task.id }, "commit-message", false);
  return (
    <RecordFold
      fold={fold}
      icon="git-commit-horizontal"
      title="Commit message"
      summary={commitMessageSummary(task)}
      side={
        editable &&
        !editing && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              fold.open();
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )
      }
    >
      {changing.error && (
        <RefusalAlert title="The commit message wasn't saved" error={changing.error} />
      )}
      {editing ? (
        <PartEditor
          label="Commit message"
          hint="The message of the one commit Publish lands the Task as: a subject line, a blank line, then the body. Leave it empty for the default."
          initial={task.commitMessage}
          saving={changing.isPending}
          onSave={(text) => changing.mutate(text, { onSuccess: () => setEditing(false) })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <pre className="task-commit-message">{task.commitMessage}</pre>
          {published ? (
            <p className="task-quiet">{COMMIT_MESSAGE_PUBLISHED}</p>
          ) : (
            !task.commitMessageWritten && <p className="task-quiet">{NO_COMMIT_MESSAGE}</p>
          )}
        </>
      )}
    </RecordFold>
  );
}

/** The folded line: the message's subject, saying when it is the default or published. */
export function commitMessageSummary(
  task: Pick<Task, "commitMessage" | "commitMessageWritten" | "commitMessagePublishedAt">,
): string {
  const subject = task.commitMessage.split("\n", 1)[0] ?? "";
  if (task.commitMessagePublishedAt !== null) return `Published · ${subject}`;
  return task.commitMessageWritten ? subject : `Default · ${subject}`;
}
