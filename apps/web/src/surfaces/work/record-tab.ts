/** A tab of a Task's record other than Overview, which the address leaves out. */
export type RecordTab = "changes" | "attachments";

/** The tab an address or a click names; undefined for Overview and anything unknown. */
export function recordTabOf(value: unknown): RecordTab | undefined {
  return value === "changes" || value === "attachments" ? value : undefined;
}
