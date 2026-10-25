/** The input fields that say what a tool call is about, in the order they are looked for. */
const SUBJECT_FIELDS = ["file_path", "pattern", "command", "url", "query", "path", "description"];

/** Long enough for a path or a command; the log shows one line. */
const SUMMARY_LENGTH = 200;

/** What a tool call read, ran or looked up, in a line for the Thread's log. */
export function toolActivitySummary(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const fields = new Map<string, unknown>(Object.entries(input));
  const subject = SUBJECT_FIELDS.map((field) => fields.get(field)).find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  if (subject === undefined) return "";
  const line = subject.replace(/\s+/g, " ").trim();
  return line.length > SUMMARY_LENGTH ? `${line.slice(0, SUMMARY_LENGTH - 1)}…` : line;
}
