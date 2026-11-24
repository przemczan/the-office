/** A tab of a Task's record other than Overview, which the address leaves out. */
export type RecordTab = "changes" | "attachments" | "engine";

/** The record's place on the Task's page, for a way to it from elsewhere on the page. */
export const RECORD_ELEMENT_ID = "task-record";

/** The tab an address or a click names; undefined for Overview and anything unknown. */
export function recordTabOf(value: unknown): RecordTab | undefined {
  return value === "changes" || value === "attachments" || value === "engine" ? value : undefined;
}
