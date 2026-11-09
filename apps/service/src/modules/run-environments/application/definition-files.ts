import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  DEFINITION_FILE,
  DEFINITION_FOLDER,
  readDefinition,
  readDevcontainer,
  type DefinitionFileText,
  type DefinitionReading,
  type Reading,
  type RunEnvironmentDefinition,
} from "../domain/run-environment-definition.js";
import type { ImageInputs, KeyedFile } from "../domain/run-environment-image.js";
import type { TaskInWorktree } from "../domain/run-environment.js";

/** Reads and validates the Run environment definition in a worktree or checkout. */
export async function readDefinitionIn(folder: string): Promise<Reading<RunEnvironmentDefinition>> {
  return (await readDefinitionWith((path) => textOf(join(folder, path)))).reading;
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

/** What the Task's image is made from, read from its worktree. */
export async function imageInputsOf(task: TaskInWorktree): Promise<ImageInputs> {
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

async function keyedFile(worktree: string, path: string): Promise<KeyedFile> {
  return {
    path: relative(worktree, path).split(sep).join("/"),
    content: await readFile(path).catch(() => undefined),
  };
}

/** Every file in the folder and its subfolders, as absolute paths. */
async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

async function textOf(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}
