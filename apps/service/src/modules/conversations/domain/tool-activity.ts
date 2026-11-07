/** The input fields that say what a tool call is about, in the order they are looked for. */
const SUBJECT_FIELDS = [
  "file_path",
  "filePath",
  "pattern",
  "command",
  "url",
  "query",
  "path",
  "description",
];

/**
 * What a tool call read, ran or looked up, whole and with its line breaks, for the Thread's log; a
 * path inside the session's folder reads from there.
 */
export function toolActivitySummary(input: unknown, folder: string): string {
  if (typeof input !== "object" || input === null) return "";
  const fields = new Map<string, unknown>(Object.entries(input));
  const subject = SUBJECT_FIELDS.map((field) => fields.get(field)).find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  if (subject === undefined) return "";
  return withinFolder(subject.trim(), folder);
}

function withinFolder(subject: string, folder: string): string {
  if (!subject.startsWith(folder)) return subject;
  const inside = subject.slice(folder.length).replace(/^[\\/]+/, "");
  return inside === "" ? subject : inside;
}
