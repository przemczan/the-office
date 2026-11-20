import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// The tool's copy of the service's carry-over of a Claude Code session to another engine's config
// folder (apps/service/src/modules/engine/adapters/claude-code/session-carry-over.ts,
// `carrySessionBetweenFolders`), as the tool runs on Node's type stripping and imports nothing from
// the service. A change there comes here too, so the checks carry a session as The Office does.

/**
 * Carries the ended session `sessionId` from the config folder `fromFolder` to `toFolder`: its
 * transcript `projects/<name>/<id>.jsonl`, found by its file name, and the folder beside it,
 * `<id>/` (Sub-agents' transcripts, saved tool results), into the same `projects/<name>/`, with
 * `fromFolder` named in a `.jsonl` file rewritten to `toFolder`; its `todos/<id>-*.json` too, and
 * `file-history/` left behind. Each file is written beside its target and renamed into place, the
 * transcript last. False, with nothing written, when `fromFolder` holds no transcript of it.
 */
export async function carrySessionBetweenFolders(
  sessionId: string,
  fromFolder: string,
  toFolder: string,
): Promise<boolean> {
  const projects: string[] = [];
  for (const project of await entriesOf(join(fromFolder, "projects"))) {
    const transcript = join(fromFolder, "projects", project.name, `${sessionId}.jsonl`);
    if (project.isDirectory() && (await isFile(transcript))) projects.push(project.name);
  }
  if (projects.length === 0) return false;
  const rewrite = folderRewrite(resolve(fromFolder), resolve(toFolder));
  for (const project of projects) {
    const source = join(fromFolder, "projects", project);
    const target = join(toFolder, "projects", project);
    await copyFolder(join(source, sessionId), join(target, sessionId), rewrite);
    await copyFile(join(source, `${sessionId}.jsonl`), join(target, `${sessionId}.jsonl`), rewrite);
  }
  for (const entry of await entriesOf(join(fromFolder, "todos"))) {
    if (entry.isFile() && entry.name.startsWith(`${sessionId}-`) && entry.name.endsWith(".json")) {
      await copyFile(
        join(fromFolder, "todos", entry.name),
        join(toFolder, "todos", entry.name),
        (text) => text,
      );
    }
  }
  return true;
}

type Rewrite = (text: string) => string;

/** `from` rewritten to `to` as a POSIX path and as a Windows path inside JSON, whole names only. */
export function folderRewrite(from: string, to: string): Rewrite {
  const forms = [
    [from.replaceAll("\\", "/"), to.replaceAll("\\", "/")],
    [jsonWindowsForm(from), jsonWindowsForm(to)],
  ] as const;
  return (text) =>
    forms.reduce(
      (rewritten, [fromForm, toForm]) =>
        rewritten.replace(
          new RegExp(`${fromForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._-])`, "g"),
          () => toForm,
        ),
      text,
    );
}

function jsonWindowsForm(folder: string): string {
  return folder.replaceAll("/", "\\").replaceAll("\\", "\\\\");
}

async function copyFolder(source: string, target: string, rewrite: Rewrite): Promise<void> {
  for (const entry of await entriesOf(source)) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) await copyFolder(from, to, rewrite);
    else if (entry.isFile()) await copyFile(from, to, rewrite);
  }
}

async function copyFile(from: string, to: string, rewrite: Rewrite): Promise<void> {
  const content: string | Buffer = from.endsWith(".jsonl")
    ? rewrite(await readFile(from, "utf8"))
    : await readFile(from);
  await mkdir(dirname(to), { recursive: true, mode: 0o700 });
  const written = `${to}.${randomUUID()}.carrying`;
  try {
    await writeFile(written, content, { flag: "wx", mode: 0o600 });
    await rename(written, to);
  } catch (error) {
    await rm(written, { force: true });
    throw error;
  }
}

async function entriesOf(folder: string) {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
