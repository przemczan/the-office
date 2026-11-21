import { useQuery } from "@tanstack/react-query";
import type { DropReason, TaskSummary } from "@the-office/contracts";
import { Field, RadioList, SearchableSelect, Textarea } from "@the-office/ui";
import { useId, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { useEveryTask } from "../../api/work.ts";

/** The reason as the field holds it while the user picks: no Kind picked yet is "". */
export interface DropReasonDraft {
  readonly kind: DropReason["kind"] | "";
  /** The Task it duplicates, for Duplicate; "" until one is picked. */
  readonly taskId: string;
  /** Other's words. */
  readonly text: string;
}

export const NO_DROP_REASON: DropReasonDraft = { kind: "", taskId: "", text: "" };

/** Other's words at most. */
export const OTHER_REASON_MAX = 500;

const REASON_KINDS = ["wont-fix", "duplicate", "cant-reproduce", "other"] as const;

const REASON_WORDS: Readonly<Record<DropReason["kind"], string>> = {
  "wont-fix": "Won't fix",
  duplicate: "Duplicate",
  "cant-reproduce": "Can't reproduce",
  other: "Other",
};

/**
 * What Drop sends for the reason as picked: none when none is picked, or why it can't be sent yet,
 * as Drop's hover says it.
 */
export function dropReasonOf(
  draft: DropReasonDraft,
): { readonly reason?: DropReason } | { readonly missing: string } {
  switch (draft.kind) {
    case "":
      return {};
    case "duplicate":
      return draft.taskId === ""
        ? { missing: "Pick the Task it duplicates" }
        : { reason: { kind: "duplicate", taskId: draft.taskId } };
    case "other":
      return draft.text.trim() === ""
        ? { missing: "Write the reason first" }
        : { reason: { kind: "other", text: draft.text.trim() } };
    case "wont-fix":
    case "cant-reproduce":
      return { reason: { kind: draft.kind } };
  }
}

/**
 * How a Dropped Task's reason reads (docs/design/issues-as-tasks.html, "Drop and Archived"):
 * "won't fix", "can't reproduce" or Other's words; a Duplicate's reads with its Task's title.
 */
export function dropReasonWords(reason: DropReason, duplicated: TaskSummary | undefined): string {
  switch (reason.kind) {
    case "wont-fix":
      return "Won't fix";
    case "cant-reproduce":
      return "Can't reproduce";
    case "other":
      return reason.text;
    case "duplicate":
      return `Duplicate of ${duplicated?.title ?? "a Task no longer readable"}`;
  }
}

/**
 * Drop's optional reason, shared by the Drop window and the Gate's Drop step: nothing picked at
 * first, the picked one pressed again clearing it; Duplicate asks which Task, any but this one in any
 * Project, Done, Dropped and archived ones too; Other asks the words.
 */
export function DropReasonField({
  task,
  draft,
  onChange,
}: {
  readonly task: TaskSummary;
  readonly draft: DropReasonDraft;
  readonly onChange: (draft: DropReasonDraft) => void;
}): ReactNode {
  const name = useId();
  const tasks = useEveryTask().data ?? [];
  const others = tasks.filter(({ id }) => id !== task.id);
  // What Duplicate and Other ask further, right under them while picked.
  const details: Partial<Record<DropReason["kind"], ReactNode>> = {
    duplicate: (
      <>
        <SearchableSelect
          label="The Task it duplicates"
          labelHidden
          placeholder="Find a Task by its title"
          value={draft.taskId}
          options={others.map(({ id, title }) => ({ value: id, label: title }))}
          onChange={(taskId) => onChange({ ...draft, taskId })}
          clearLabel="Clear the Task it duplicates"
          noMatches="No Task matches"
        />
        <p className="dialog-hint">The Task this one duplicates. Required for Duplicate.</p>
      </>
    ),
    other: (
      <Textarea
        aria-label="Why it is dropped"
        rows={3}
        maxLength={OTHER_REASON_MAX}
        required
        value={draft.text}
        onChange={(event) => onChange({ ...draft, text: event.target.value })}
      />
    ),
  };
  return (
    <Field label="Reason" hint="Optional.">
      <RadioList
        label="Reason"
        name={name}
        clearable
        options={REASON_KINDS.map((kind) => ({
          value: kind,
          label: REASON_WORDS[kind],
          detail: details[kind],
        }))}
        value={draft.kind}
        onChange={(picked) =>
          onChange({ ...draft, kind: REASON_KINDS.find((kind) => kind === picked) ?? "" })
        }
      />
      <IssueClosedLine task={task} />
    </Field>
  );
}

/**
 * Says the Task's GitHub issue will be closed with the reason, while it has one and its Project's
 * "Close with the drop reason" switch is on.
 */
function IssueClosedLine({ task }: { readonly task: TaskSummary }): ReactNode {
  const issue = useQuery(projectQueries.issueLink(task.id)).data;
  const project = useQuery(projectQueries.list()).data?.find(({ id }) => id === task.projectId);
  if (!issue || !project?.issueSettings.closeOnDrop) return null;
  return (
    <p className="dialog-hint">
      GitHub issue #{issue.number} will be closed with this reason, as {project.name} closes issues
      of dropped Tasks.
    </p>
  );
}
