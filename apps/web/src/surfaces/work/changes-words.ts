import type { ChangedFile, TestResultState } from "@the-office/contracts";

/**
 * What the Changes tab shows beside the diff (prototypes/app/task.js, `changesHtml`): each
 * file's lines, how each diff line reads, and the latest results of the Task's test Script Stages.
 */

/** A line of a unified diff, by what it is. */
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

/** "+14 −6", or "binary" for a file whose lines git doesn't count. */
export function fileLineWords({
  lines,
}: ChangedFile): { added: string; removed: string } | "binary" {
  return lines ? { added: `+${lines.added}`, removed: `−${lines.removed}` } : "binary";
}

/** Each test result as the Changes tab words it. */
export const TEST_RESULT_WORDS: Readonly<Record<TestResultState, string>> = {
  passed: "passed",
  failed: "failed",
  skipped: "skipped",
  "not-run": "not run yet",
};

/**
 * A link that opens a folder or file of the Task's worktree in VS Code (the user's answer of
 * 2026-10-26): `vscode://file/` and the path with "/" between folders, a Windows drive letter
 * kept as it is, and what a URL can't hold escaped.
 */
export function editorLink(worktreePath: string, filePath?: string): string {
  const path = [worktreePath.replace(/[/\\]+$/, ""), filePath]
    .filter((part) => part !== undefined)
    .join("/")
    .replaceAll("\\", "/");
  const rooted = path.startsWith("/") ? path : `/${path}`;
  return `vscode://file${encodeURI(rooted).replaceAll("#", "%23").replaceAll("?", "%3F")}`;
}
