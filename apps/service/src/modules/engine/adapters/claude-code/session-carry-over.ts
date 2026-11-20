import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { moveWhenFree } from "../../../../platform/os/move-when-free.js";
import type { Engine } from "../../domain/engines.js";
import { SessionNotCarried } from "../../ports/agent-engine.js";
import { ownEngineConfigFolder } from "../engine-folders/engine-config-folder.js";

/** Where the binary keeps a session's transcript, by the session's working folder, in its config folder. */
const PROJECTS = "projects";
/** A session's todo lists, `<session id>-*.json`, in its config folder. */
const TODOS = "todos";

/**
 * Carries the ended Claude Code session `sessionId` over from `from`'s config folder to `to`'s, so a
 * session on `to` resumes it (a Stand-in Engine taking over, spec §5.4): its transcript
 * `projects/<name>/<id>.jsonl`, found by its file name under any `projects/<name>/`, and the folder
 * beside it, `<id>/` (its Sub-agents' transcripts and its saved tool results), go to the same
 * `projects/<name>/` there, with `from`'s folder named in a `.jsonl` file rewritten to `to`'s, as
 * tool results are named by absolute path; its todo lists go too. `file-history/` stays behind.
 *
 * Each file is written beside its target and renamed into place, the transcript last, so a failure
 * leaves no partial file and no transcript without its folder. Carrying it again writes the same
 * files over, so a crash is replayed safely; `from`'s folder is never changed. Throws
 * `SessionNotCarried` when `from` holds no transcript of the session.
 */
export async function carrySessionOver(
  officeData: OfficeDataDirectory,
  sessionId: string,
  from: Engine,
  to: Engine,
): Promise<void> {
  const carried = await carrySessionBetweenFolders(
    sessionId,
    ownEngineConfigFolder(officeData, from.id),
    ownEngineConfigFolder(officeData, to.id),
  );
  if (!carried) throw new SessionNotCarried(sessionId, from.id);
}

/**
 * `carrySessionOver` between two config folders; false, with nothing written, when `fromFolder`
 * holds no transcript of the session. The engine check carries sessions with a copy of it
 * (`tools/engine-check/src/session-carry-over.ts`): a change here goes there too.
 */
export async function carrySessionBetweenFolders(
  sessionId: string,
  fromFolder: string,
  toFolder: string,
): Promise<boolean> {
  const projects = await projectsHolding(fromFolder, sessionId);
  if (projects.length === 0) return false;
  const rewrite = folderRewrite(resolve(fromFolder), resolve(toFolder));
  for (const project of projects) {
    const source = join(fromFolder, PROJECTS, project);
    const target = join(toFolder, PROJECTS, project);
    await copyFolder(join(source, sessionId), join(target, sessionId), rewrite);
    await copyFile(join(source, `${sessionId}.jsonl`), join(target, `${sessionId}.jsonl`), rewrite);
  }
  await copyTodos(fromFolder, toFolder, sessionId);
  return true;
}

/** The `projects/` folders of `configFolder` holding the session's transcript. */
async function projectsHolding(configFolder: string, sessionId: string): Promise<string[]> {
  const projects = await entriesOf(join(configFolder, PROJECTS));
  const holding: string[] = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    if (await isFile(join(configFolder, PROJECTS, project.name, `${sessionId}.jsonl`))) {
      holding.push(project.name);
    }
  }
  return holding;
}

type Rewrite = (text: string) => string;

/**
 * Rewrites the absolute folder `from` to `to` where a transcript names it: as a POSIX path and as a
 * Windows path inside a JSON string, its backslashes doubled. Only a whole folder name matches, so
 * an engine whose id starts with `from`'s is left alone.
 */
export function folderRewrite(from: string, to: string): Rewrite {
  const forms = [
    [posixForm(from), posixForm(to)],
    [jsonWindowsForm(from), jsonWindowsForm(to)],
  ] as const;
  return (text) =>
    forms.reduce(
      (rewritten, [fromForm, toForm]) =>
        rewritten.replace(
          new RegExp(`${escapedPattern(fromForm)}(?![A-Za-z0-9._-])`, "g"),
          () => toForm,
        ),
      text,
    );
}

function posixForm(folder: string): string {
  return folder.replaceAll("\\", "/");
}

function jsonWindowsForm(folder: string): string {
  return folder.replaceAll("/", "\\").replaceAll("\\", "\\\\");
}

function escapedPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Copies `source` into `target` file by file, every `.jsonl` rewritten; none when it is missing. */
async function copyFolder(source: string, target: string, rewrite: Rewrite): Promise<void> {
  for (const entry of await entriesOf(source)) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) await copyFolder(from, to, rewrite);
    else if (entry.isFile()) await copyFile(from, to, rewrite);
  }
}

/** Writes `to` beside itself and renames it into place, a `.jsonl` file's text rewritten. */
async function copyFile(from: string, to: string, rewrite: Rewrite): Promise<void> {
  const content: string | Buffer = from.endsWith(".jsonl")
    ? rewrite(await readFile(from, "utf8"))
    : await readFile(from);
  await mkdir(dirname(to), { recursive: true, mode: 0o700 });
  const written = `${to}.${randomUUID()}.carrying`;
  try {
    await writeFile(written, content, { flag: "wx", mode: 0o600 });
    await moveWhenFree(written, to);
  } catch (error) {
    await rm(written, { force: true });
    throw error;
  }
}

/** The session's todo lists, `todos/<session id>-*.json`, if any. */
async function copyTodos(fromFolder: string, toFolder: string, sessionId: string): Promise<void> {
  for (const entry of await entriesOf(join(fromFolder, TODOS))) {
    if (!entry.isFile() || !entry.name.startsWith(`${sessionId}-`) || !entry.name.endsWith(".json"))
      continue;
    await copyFile(
      join(fromFolder, TODOS, entry.name),
      join(toFolder, TODOS, entry.name),
      (text) => text,
    );
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
