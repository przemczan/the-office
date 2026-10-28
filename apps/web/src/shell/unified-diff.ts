export type DiffLineKind = "file" | "hunk" | "added" | "removed" | "context";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

/** Each line of a unified diff with its kind, as the tab colours it. */
export function diffLines(diff: string): DiffLine[] {
  if (diff === "") return [];
  const lines = diff.endsWith("\n") ? diff.slice(0, -1).split("\n") : diff.split("\n");
  let inHunk = false;
  return lines.map((text) => {
    if (text.startsWith("diff --git ")) inHunk = false;
    else if (text.startsWith("@@")) inHunk = true;
    return { kind: diffLineKind(text, inHunk), text };
  });
}

/** Inside a hunk "+++" and "---" are a line's content; before one they name the file. */
function diffLineKind(text: string, inHunk: boolean): DiffLineKind {
  if (text.startsWith("@@")) return "hunk";
  if (!inHunk) return "file";
  if (text.startsWith("+")) return "added";
  if (text.startsWith("-")) return "removed";
  return "context";
}
