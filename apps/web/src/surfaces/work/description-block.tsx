import type { Task } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeDescription } from "../../api/work.ts";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { NOT_STARTED } from "../../shell/work/work-words.ts";
import {
  BugSection,
  CausedBugsSections,
  FoundWhileWorkingOnSection,
  GitHubIssueSection,
} from "./bug-section.tsx";
import { ConflictResolutionSection } from "./conflict-resolution-parts.tsx";
import { DependenciesSection, useDependencies } from "./dependencies-block.tsx";
import { dependenciesSummary } from "./dependency-words.ts";
import { TaskInitiativeSection } from "./initiative-membership.tsx";
import { OriginDetails, useOrigin } from "./origin-block.tsx";
import { PartEditor } from "./part-editor.tsx";
import { useRecordChange } from "./planning-parts.tsx";
import { descriptionSummary, NO_DESCRIPTION } from "./planning-words.ts";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";

/**
 * The user's Description: what they want, in their own words, which the Planner plans from, with
 * a Bug's details, its GitHub issue, the Task's Dependencies, the Bugs it caused and its duplicates,
 * the Task it was found while working on, its Conflict resolution links, its Initiative and its
 * Origin below it. The text stays editable until the Task starts; the block starts open in every
 * state (the user, 2026-11-11).
 */
export function DescriptionBlock({ task }: { readonly task: Task }): ReactNode {
  const changing = useRecordChange(task, (description: string) =>
    changeDescription(task.id, description),
  );
  const [editing, setEditing] = useState(false);
  const editable = NOT_STARTED.includes(task.state);
  const fold = useFold({ kind: "task", id: task.id }, "description", true);
  const { blockers, waiting } = useDependencies(task);
  const origin = useOrigin(task.originIdeaId, task.projectMoves);
  const summary = [
    descriptionSummary(task),
    ...(blockers.length > 0 || waiting.length > 0 ? [dependenciesSummary(blockers, waiting)] : []),
  ].join(" · ");
  return (
    <RecordFold
      fold={fold}
      icon="align-left"
      title="Description"
      summary={summary}
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
        <RefusalAlert title="The Description wasn't saved" error={changing.error} />
      )}
      {editing ? (
        <PartEditor
          label="Description"
          hint="What you want, in your own words, in Markdown; type @ to mention a Task, Initiative, Decision or Idea. The title alone is enough to plan from."
          initial={task.description}
          mentions
          saving={changing.isPending}
          onSave={(text) => changing.mutate(text, { onSuccess: () => setEditing(false) })}
          onCancel={() => setEditing(false)}
        />
      ) : task.description === "" ? (
        <p className="task-quiet">{NO_DESCRIPTION}</p>
      ) : (
        <div className="task-plan-text">
          <MarkdownText text={task.description} />
        </div>
      )}
      <BugSection task={task} />
      <GitHubIssueSection task={task} />
      <DependenciesSection task={task} />
      <CausedBugsSections task={task} />
      <FoundWhileWorkingOnSection task={task} />
      <ConflictResolutionSection task={task} />
      <TaskInitiativeSection task={task} />
      {origin && (
        <section className="task-record-section" aria-label="Origin">
          <div className="task-record-section-head">
            <h3 className="task-record-section-title">Origin</h3>
          </div>
          <OriginDetails origin={origin} />
        </section>
      )}
    </RecordFold>
  );
}
