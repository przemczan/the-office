import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { Engine } from "../../domain/engines.js";
import { ownEngineConfigFolder } from "../engine-folders/engine-config-folder.js";

/** Where the binary keeps a session's transcript, by the session's working folder. */
const PROJECTS = "projects";
/** A session's todo lists, `<session id>-*.json`. */
const TODOS = "todos";

/** The ids of sessions name files, so none may lead out of the config folder. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Removes the Claude Code session `sessionId`'s files from the engine's config folder: its
 * transcript `projects/<name>/<id>.jsonl`, the folder beside it (`<id>/`, its Sub-agents'
 * transcripts and saved tool results) under every `projects/<name>/`, and its todo lists. Whatever
 * isn't there is left alone; the session must have ended.
 */
export async function forgetSessionFiles(
  officeData: OfficeDataDirectory,
  sessionId: string,
  engine: Engine,
): Promise<void> {
  if (!SESSION_ID.test(sessionId)) return;
  const configFolder = ownEngineConfigFolder(officeData, engine.id);
  for (const project of await entriesOf(join(configFolder, PROJECTS))) {
    if (!project.isDirectory()) continue;
    const folder = join(configFolder, PROJECTS, project.name);
    await rm(join(folder, `${sessionId}.jsonl`), { force: true });
    await rm(join(folder, sessionId), { recursive: true, force: true });
  }
  for (const todo of await entriesOf(join(configFolder, TODOS))) {
    if (todo.isFile() && todo.name.startsWith(`${sessionId}-`) && todo.name.endsWith(".json")) {
      await rm(join(configFolder, TODOS, todo.name), { force: true });
    }
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
