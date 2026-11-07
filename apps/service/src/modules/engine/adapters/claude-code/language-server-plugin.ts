import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LanguageServer } from "../../domain/language-servers.js";

/**
 * Its own plugin, not the skills folder's: a session with no skills still gets its servers, and
 * the skills start check stays exact.
 */
const PLUGIN_NAME = "office-language-servers";

/** What the plugin's manifest holds; the engine loads `lspServers` as it loads a session's skills. */
export function languageServerManifest(servers: readonly LanguageServer[]): object {
  return {
    name: PLUGIN_NAME,
    lspServers: Object.fromEntries(
      servers.map(({ command, arguments: args, languages, initializationOptions }) => [
        command,
        {
          command,
          args,
          extensionToLanguage: languages,
          ...(initializationOptions !== undefined && { initializationOptions }),
        },
      ]),
    ),
  };
}

/**
 * Writes the plugin holding the session's language servers in its folder of the Office data, the
 * Office rules refusing it there, and gives the plugin's folder. None for a session with no server,
 * which then has no LSP tool (the engine check's `engine.lsp-tool`).
 */
export async function writeLanguageServerPlugin(
  sessionsFolder: string,
  sessionId: string,
  servers: readonly LanguageServer[],
): Promise<string | undefined> {
  if (servers.length === 0) return undefined;
  const folder = join(sessionsFolder, sessionId, "language-servers");
  await mkdir(join(folder, ".claude-plugin"), { recursive: true, mode: 0o700 });
  await writeFile(
    join(folder, ".claude-plugin", "plugin.json"),
    JSON.stringify(languageServerManifest(servers)),
  );
  return folder;
}
