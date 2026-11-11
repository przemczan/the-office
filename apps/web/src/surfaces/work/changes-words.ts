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
 * Each changed file's part of a Task's diff, from its "diff --git" line to the next, by the file's
 * path; a file the diff stops before is absent. The diff is split once, as it can hold many files.
 */
export function diffsOfFiles(
  diff: string,
  files: readonly ChangedFile[],
): ReadonlyMap<string, string> {
  const paths = new Set(files.map(({ path }) => path));
  const diffs = new Map<string, string>();
  for (const part of diff.split(/^(?=diff --git )/m)) {
    for (const path of headerPaths(part.split("\n", 1)[0] ?? "")) {
      if (paths.has(path) && !diffs.has(path)) diffs.set(path, part);
    }
  }
  return diffs;
}

/**
 * Every path a "diff --git" header can end with: what follows a " b/", or a ' "b/' up to the closing
 * quote, as git quotes a path holding unusual characters. An unquoted path may itself hold " b/",
 * so each one is a candidate.
 */
function headerPaths(header: string): string[] {
  const candidates: string[] = [];
  for (const [marker, closing] of [
    [" b/", ""],
    [' "b/', '"'],
  ] as const) {
    if (!header.endsWith(closing)) continue;
    for (let at = header.indexOf(marker); at !== -1; at = header.indexOf(marker, at + 1)) {
      candidates.push(header.slice(at + marker.length, header.length - closing.length));
    }
  }
  return candidates;
}
