import type { ChangedFile, TestResultState } from "@the-office/contracts";

/**
 * What the Changes tab shows beside the diff (prototypes/app/task.js, `changesHtml`): each
 * file's lines, how each diff line reads, and the latest results of the Task's test Script Stages.
 */

/** A line of a unified diff, by what it is. */
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

/**
 * The part of a Task's diff for one changed file, from its "diff --git" line to the next; undefined
 * when the diff stops before it. git quotes a path holding unusual characters.
 */
export function diffOfFile(diff: string, path: string): string | undefined {
  return diff.split(/^(?=diff --git )/m).find((file) => {
    const header = file.split("\n", 1)[0] ?? "";
    return header.endsWith(` b/${path}`) || header.endsWith(` "b/${path}"`);
  });
}
