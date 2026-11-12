import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { EngineId } from "../../domain/engines.js";

/**
 * The folder a Claude Code engine's sessions run with as `CLAUDE_CONFIG_DIR` (spec §5.6, §6): its
 * account and its sessions' transcripts, `<office-data>/engines/<engine id>/`. The Office rules
 * refuse it as a secret, all but the transcripts in its `projects/`, which only a session reaching
 * the workstation reads, as the rest of the data directory is refused to every other.
 */
export function engineConfigFolder(officeData: OfficeDataDirectory, engineId: EngineId): string {
  return join(officeData.folder("engines"), engineId);
}

/**
 * The engine's folder, made when missing: the engine the upgrade made has none until its first
 * session. Owner-only on Linux; on Windows it takes the data directory's access list.
 */
export async function preparedEngineConfigFolder(
  officeData: OfficeDataDirectory,
  engineId: EngineId,
): Promise<string> {
  const folder = engineConfigFolder(officeData, engineId);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  return folder;
}

/** An engine id that names no folder of its own under the engines' folder. */
export class NotAnEngineConfigFolder extends Error {
  constructor(readonly engineId: EngineId) {
    super(`"${engineId}" names no engine's own folder in the Office data directory.`);
  }
}

/**
 * The engine's folder, for removing it or changing its account. Only a folder directly in the
 * engines' folder is given: an id that leads anywhere else is refused, as changing it could touch
 * the data directory or the user's files.
 */
export function ownEngineConfigFolder(officeData: OfficeDataDirectory, engineId: EngineId): string {
  const folder = resolve(engineConfigFolder(officeData, engineId));
  if (dirname(folder) !== resolve(officeData.folder("engines"))) {
    throw new NotAnEngineConfigFolder(engineId);
  }
  return folder;
}

/** The ids of the engines with a folder in the engines' folder; none while it is missing. */
export async function engineIdsWithConfigFolders(
  officeData: OfficeDataDirectory,
): Promise<EngineId[]> {
  try {
    const entries = await readdir(officeData.folder("engines"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map(({ name }) => name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Removes the engine's own folder with everything in it. */
export async function removeEngineConfigFolder(
  officeData: OfficeDataDirectory,
  engineId: EngineId,
): Promise<void> {
  await rm(ownEngineConfigFolder(officeData, engineId), { recursive: true, force: true });
}
