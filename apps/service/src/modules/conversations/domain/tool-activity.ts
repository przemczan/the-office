/** The input fields that say what a tool call is about, in the order they are looked for. */
const SUBJECT_FIELDS = ["file_path", "pattern", "command", "url", "query", "path", "description"];

/** Long enough for a path or a command; the log shows one line. */
const SUMMARY_LENGTH = 200;

/**
 * What a tool call read, ran or looked up, in a line for the Thread's log; a path inside the
 * session's folder reads from there.
 */
export function toolActivitySummary(input: unknown, folder: string): string {
  if (typeof input !== "object" || input === null) return "";
  const fields = new Map<string, unknown>(Object.entries(input));
  const subject = SUBJECT_FIELDS.map((field) => fields.get(field)).find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  if (subject === undefined) return "";
  const line = withinFolder(subject.replace(/\s+/g, " ").trim(), folder);
  return line.length > SUMMARY_LENGTH ? `${line.slice(0, SUMMARY_LENGTH - 1)}…` : line;
}

function withinFolder(line: string, folder: string): string {
  if (!line.startsWith(folder)) return line;
  const inside = line.slice(folder.length).replace(/^[\\/]+/, "");
  return inside === "" ? line : inside;
}
