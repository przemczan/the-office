import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { resolvedInside } from "../../../platform/files/resolved-inside.js";
import {
  DEFINITION_FILE,
  DEFINITION_FOLDER,
  definitionFilePathOf,
  readDefinition,
  readDevcontainer,
  type DefinitionFile,
  type DefinitionFileText,
  type DefinitionReading,
  type Reading,
  type RunEnvironmentDefinition,
} from "../domain/run-environment-definition.js";
import type { ImageInputs, KeyedFile } from "../domain/run-environment-image.js";
import type { ImageSource } from "../domain/run-environment.js";

/**
 * Reads and validates the Run environment definition in a worktree or checkout, a file that leads
 * out of it read as not there.
 */
export async function readDefinitionIn(folder: string): Promise<Reading<RunEnvironmentDefinition>> {
  return (await readDefinitionWith((path) => textIn(folder, path))).reading;
}

/**
 * Reads and validates the Run environment definition through `fileText`, which answers a file's
 * text by its path in the repository, or undefined when no such file is there.
 */
export async function readDefinitionWith(fileText: DefinitionFileText): Promise<DefinitionReading> {
  const devcontainerText = await fileText(DEFINITION_FILE);
  const found = devcontainerText !== undefined;
  const devcontainer = readDevcontainer(devcontainerText);
  if (devcontainer.value === undefined) {
    return { found, reading: { problems: devcontainer.problems } };
  }
  const composeFiles = await Promise.all(
    devcontainer.value.composeFiles.map(async (path) => ({ path, text: await fileText(path) })),
  );
  return { found, reading: readDefinition(devcontainer.value, composeFiles) };
}

/** How writing the definition went: the files written and the checks' service, or every problem. */
export type DefinitionWriting =
  | { readonly written: true; readonly paths: readonly string[]; readonly service: string }
  | { readonly written: false; readonly problems: readonly string[] };

/**
 * Writes `files` into the worktree's definition folder once the definition they make is valid,
 * read as `readDefinitionWith` reads it: the given files in place of the worktree's, any other file
 * it names from the worktree. With any problem, or a path outside the folder, it writes nothing.
 * The folder's other files stay; nothing is built or started.
 */
export async function writeDefinitionIn(
  worktree: string,
  files: readonly DefinitionFile[],
): Promise<DefinitionWriting> {
  const given = new Map<string, string>();
  const problems: string[] = [];
  for (const file of files) {
    const checked = definitionFilePathOf(file.path);
    if ("problem" in checked) problems.push(checked.problem);
    else if (given.has(checked.path)) problems.push(`${checked.path} is given more than once.`);
    else given.set(checked.path, file.text);
  }
  if (files.length === 0) problems.push("Give at least one file to write.");
  const { reading } = await readDefinitionWith((path) =>
    given.has(path) ? Promise.resolve(given.get(path)) : textIn(worktree, path),
  );
  problems.push(...reading.problems);
  if (reading.value === undefined || problems.length > 0) return { written: false, problems };
  for (const [path, text] of given) {
    const target = join(worktree, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  return { written: true, paths: [...given.keys()], service: reading.value.service };
}

/** What the image is made from, read from the Task's worktree or the instance's checkout. */
export async function imageInputsOf(task: ImageSource): Promise<ImageInputs> {
  const definitionFolder = join(task.worktree, DEFINITION_FOLDER);
  const definitionFiles = await Promise.all(
    (await filesIn(definitionFolder)).map((path) => keyedFile(task.worktree, path)),
  );
  const installInputs = await Promise.all(
    task.installInputs.map((input) => keyedFile(task.worktree, join(task.worktree, input))),
  );
  return {
    definitionFiles,
    installCommand: task.installCommand,
    installInputs,
    installVariables: task.installVariables,
  };
}

/** The file by its path in the worktree, with no content unless it is one of the worktree's own. */
async function keyedFile(worktree: string, path: string): Promise<KeyedFile> {
  const source = await ownFileIn(worktree, path);
  return {
    path: relative(worktree, path).split(sep).join("/"),
    content: source === undefined ? undefined : await readFile(source).catch(() => undefined),
  };
}

/**
 * Where the file at `path` in the folder really is, once its links are followed; none when it isn't
 * there or leads out of the folder (spec §5.5, "Install inputs"), as a link an Agent made to one
 * of this computer's files would, so it is read as if it weren't there.
 */
export async function ownFileIn(folder: string, path: string): Promise<string | undefined> {
  const resolved = await resolvedInside(folder, path);
  return resolved.state === "inside" ? resolved.path : undefined;
}

/** Every file in the folder and its subfolders, as absolute paths. */
async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** The text of the folder's own file at `path`, from its root; none when it isn't one of its own. */
async function textIn(folder: string, path: string): Promise<string | undefined> {
  const source = await ownFileIn(folder, join(folder, path));
  return source === undefined ? undefined : readFile(source, "utf8").catch(() => undefined);
}
