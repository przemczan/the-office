import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Author } from "./author.js";
import type { Idea } from "./idea.js";
import type { Initiative } from "./initiative.js";
import { stateChangeCauseWords, type StateChange, type StateChangeCause } from "./state-change.js";
import type { Task } from "./task.js";
import { TASK_STATE_NAMES } from "./task-states.js";

/** A field of a Task, an Idea or an Initiative whose edits its History keeps. */
export type EditedField =
  | "title"
  | "description"
  | "kind"
  | "priority"
  | "plan"
  | "definition-of-done"
  | "notes"
  | "project"
  | "outcome";

/** The kind of record an edit was made on. */
export type EditedRecordKind = "task" | "idea" | "initiative";

/** A Task, an Idea or an Initiative, by its id, whose edits are kept. */
export interface EditedRecord {
  readonly kind: EditedRecordKind;
  readonly id: string;
}

/**
 * One edit of one field of a record, kept with who made it and when, never the old or new value:
 * saved with the change that made it, only when the field's value changed.
 */
export interface RecordEdit {
  readonly field: EditedField;
  readonly at: Date;
  readonly by: StateChangeCause;
}

/** A change of a record, with the edits it makes, kept with it as it is saved. */
interface EditingChange {
  readonly event: DomainEvent;
  readonly edits?: readonly RecordEdit[];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((each, index) => each === b[index]);
}

/** The fields of a Task whose edits are kept that differ between `before` and `after`. */
export function taskEditedFields(before: Task, after: Task): EditedField[] {
  return [
    ...(before.title === after.title ? [] : (["title"] as const)),
    ...(before.description === after.description ? [] : (["description"] as const)),
    ...(before.kind === after.kind ? [] : (["kind"] as const)),
    ...(before.priority === after.priority ? [] : (["priority"] as const)),
    ...(before.plan === after.plan && sameList(before.filesToChange, after.filesToChange)
      ? []
      : (["plan"] as const)),
    ...(sameList(before.definitionOfDone, after.definitionOfDone)
      ? []
      : (["definition-of-done"] as const)),
  ];
}

/** The fields of an Idea whose edits are kept that differ between `before` and `after`. */
export function ideaEditedFields(before: Idea, after: Idea): EditedField[] {
  return [
    ...(before.title === after.title ? [] : (["title"] as const)),
    ...(before.notes === after.notes ? [] : (["notes"] as const)),
    ...(before.projectId === after.projectId ? [] : (["project"] as const)),
  ];
}

/** The fields of an Initiative whose edits are kept that differ between `before` and `after`. */
export function initiativeEditedFields(before: Initiative, after: Initiative): EditedField[] {
  return before.outcome === after.outcome ? [] : ["outcome"];
}

/**
 * The change with an edit kept for each of `fields`, made `by` at the change's time; the change as
 * it is for none, and undefined for no change.
 */
export function withEdits<Change extends EditingChange>(
  change: Change | undefined,
  fields: readonly EditedField[],
  by: Author,
): Change | undefined {
  if (!change || fields.length === 0) return change;
  const at = change.event.occurredAt;
  return {
    ...change,
    edits: [...(change.edits ?? []), ...fields.map((field) => ({ field, at, by }))],
  };
}

/** The change of a Task, with an edit kept for each field it changed, by `by`. */
export function withTaskEdits<Change extends EditingChange & { readonly task: Task }>(
  change: Change | undefined,
  before: Task,
  by: Author,
): Change | undefined {
  return change && withEdits(change, taskEditedFields(before, change.task), by);
}

/** The change of an Idea, with an edit kept for each field it changed, by `by`. */
export function withIdeaEdits<Change extends EditingChange & { readonly idea: Idea }>(
  change: Change | undefined,
  before: Idea,
  by: Author,
): Change | undefined {
  return change && withEdits(change, ideaEditedFields(before, change.idea), by);
}

/** The change of an Initiative, with an edit kept for each field it changed, by `by`. */
export function withInitiativeEdits<
  Change extends EditingChange & { readonly initiative: Initiative },
>(change: Change | undefined, before: Initiative, by: Author): Change | undefined {
  return change && withEdits(change, initiativeEditedFields(before, change.initiative), by);
}

/** A line of a record's History: a Task's move between states, or an edit of one field. */
export type HistoryEntry =
  ({ readonly kind: "state-change" } & StateChange) | ({ readonly kind: "edit" } & RecordEdit);

/**
 * A record's History, oldest first: its state changes and its edits, each in the order it was
 * saved, merged by their time, a state change first of two made at once, as the creation comes
 * before anything done to the record.
 */
export function historyOf(
  stateChanges: readonly StateChange[],
  edits: readonly RecordEdit[],
): HistoryEntry[] {
  const merged: HistoryEntry[] = [];
  let change = 0;
  let edit = 0;
  while (change < stateChanges.length || edit < edits.length) {
    const nextChange = stateChanges[change];
    const nextEdit = edits[edit];
    if (nextChange && (!nextEdit || nextChange.at.getTime() <= nextEdit.at.getTime())) {
      merged.push({ kind: "state-change", ...nextChange });
      change += 1;
    } else if (nextEdit) {
      merged.push({ kind: "edit", ...nextEdit });
      edit += 1;
    }
  }
  return merged;
}

const FIELD_NAMES: Readonly<Record<EditedField, string>> = {
  title: "Title",
  description: "Description",
  kind: "Kind",
  priority: "Priority",
  plan: "Plan",
  "definition-of-done": "Definition of Done",
  notes: "Notes",
  project: "Project",
  outcome: "Outcome",
};

/** What a History line says happened: a move, the creation, or an edit of a field. */
export function historyEntryWords(entry: HistoryEntry): string {
  if (entry.kind === "edit") return `${FIELD_NAMES[entry.field]} edited`;
  return entry.from === undefined
    ? `created in ${TASK_STATE_NAMES[entry.to]}`
    : `${TASK_STATE_NAMES[entry.from]} → ${TASK_STATE_NAMES[entry.to]}`;
}

/**
 * A record's History as an Agent reads it, oldest first, each line with who or what made it. A Task's
 * whose kept state changes don't start at its creation says so (`keptFromCreation` false).
 */
export function historyLines(entries: readonly HistoryEntry[], keptFromCreation = true): string[] {
  return [
    keptFromCreation
      ? "History:"
      : "History since The Office began keeping it (earlier changes weren't kept):",
    ...(entries.length === 0
      ? ["None kept yet."]
      : entries.map(
          (entry) =>
            `- ${entry.at.toISOString()}: ${historyEntryWords(entry)}, by ${stateChangeCauseWords(entry.by)}`,
        )),
  ];
}

/** A Task's History as its record words it, from its kept state changes and edits. */
export function taskHistoryLines(
  stateChanges: readonly StateChange[],
  edits: readonly RecordEdit[],
): string[] {
  const first = stateChanges[0];
  const keptFromCreation = first !== undefined && first.from === undefined;
  return historyLines(historyOf(stateChanges, edits), keptFromCreation);
}
