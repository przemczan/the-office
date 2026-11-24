import type { EditedField, History, HistoryEntry } from "@the-office/contracts";
import { TASK_STATE_NAMES } from "../../shell/work/work-words.ts";
import { momentWords } from "../../shell/time.ts";

/** Each field whose edits a History keeps, as the record's blocks name it. */
export const EDITED_FIELD_NAMES: Readonly<Record<EditedField, string>> = {
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

/**
 * One line of a History, without its time: "Moved from Ready to Planning by the user Ann Lee",
 * "Created in Backlog by …", "Title edited by the person in the Role planner".
 */
export function historyEntryWords(entry: HistoryEntry): string {
  if (entry.kind === "edit") return `${EDITED_FIELD_NAMES[entry.field]} edited by ${entry.by}`;
  const to = TASK_STATE_NAMES[entry.to];
  return entry.from === null
    ? `Created in ${to} by ${entry.by}`
    : `Moved from ${TASK_STATE_NAMES[entry.from]} to ${to} by ${entry.by}`;
}

/** The folded line: "Nothing yet", or "3 changes · last 14:02". */
export function historySummary(history: History | undefined, now: Date = new Date()): string {
  if (history === undefined) return "";
  const last = history.at(-1);
  if (last === undefined) return "Nothing yet";
  const count = history.length === 1 ? "1 change" : `${history.length} changes`;
  return `${count} · last ${momentWords(last.at, now)}`;
}
