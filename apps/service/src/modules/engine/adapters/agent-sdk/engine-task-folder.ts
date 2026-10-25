import type { OperatingSystem } from "../../../../platform/os/operating-system.js";

/**
 * Where the engine writes the output of a session's background commands, which the session may
 * read (spec §6): `<engine temporary folder>/<working folder, each character other than a letter
 * or digit a dash>/<session id>/tasks`, as Claude Code 2.1.310 names it on both systems.
 */
export function engineTaskFolder(
  { engineTemporaryFolder, paths }: Pick<OperatingSystem, "engineTemporaryFolder" | "paths">,
  workingFolder: string,
  sessionId: string,
): string {
  return paths.join(
    engineTemporaryFolder,
    workingFolder.replaceAll(/[^a-zA-Z0-9]/g, "-"),
    sessionId,
    "tasks",
  );
}
