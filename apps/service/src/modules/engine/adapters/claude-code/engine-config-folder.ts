import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import type { EngineId } from "../../domain/engines.js";

/**
 * The folder a Claude Code engine's sessions run with as `CLAUDE_CONFIG_DIR` (spec §5.6, §6): its
 * account and its sessions' transcripts, `<office-data>/engines/<engine id>/`, which the Office
 * rules refuse as they refuse the rest of the data directory.
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
