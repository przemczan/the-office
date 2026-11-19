import { join } from "node:path";
import { markdownFile, markdownFilesIn, textOrNone } from "../skills/markdown-file.js";

/** An instruction file of the session's folder, with what it says. */
export interface InstructionFile {
  readonly path: string;
  readonly text: string;
}

/**
 * The Project's instruction files that the SDK adapter's sessions load (`settingSources:
 * ['project']`, with `claudeMdExcludes` keeping those above the folder out): the folder's
 * `CLAUDE.md` and `.claude/CLAUDE.md`, then each rule in `.claude/rules/` that applies to every
 * file. A rule whose frontmatter names `paths` applies only to those files, and a nested
 * `CLAUDE.md` only once a file below it is read; both are left out, as are `@` imports, which
 * stay as written. `CLAUDE.local.md` is the local settings' and isn't loaded.
 */
export async function projectInstructions(folder: string): Promise<InstructionFile[]> {
  const rulesFolder = join(folder, ".claude", "rules");
  const files = [
    join(folder, "CLAUDE.md"),
    join(folder, ".claude", "CLAUDE.md"),
    ...(await markdownFilesIn(rulesFolder)),
  ];
  const found: InstructionFile[] = [];
  for (const path of files) {
    const text = await textOrNone(path);
    if (text === undefined || text.trim() === "") continue;
    if (path.startsWith(rulesFolder) && markdownFile(text).frontmatter["paths"] !== undefined) {
      continue;
    }
    found.push({ path, text: text.trim() });
  }
  return found;
}
