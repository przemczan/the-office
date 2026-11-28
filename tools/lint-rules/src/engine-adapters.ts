/** The Engine module's adapters, each engine type's in a folder of its own. */
const ENGINE_ADAPTERS = "src/modules/engine/adapters/";

/** The folders that each hold one engine type's adapter, the scripted one for tests included. */
export const ENGINE_TYPE_FOLDERS: readonly string[] = [
  "agent-sdk",
  "claude-code",
  "claude-code-p",
  "codex",
  "copilot-cli",
  "gemini-cli",
  "openai-compatible-api",
  "scripted",
];

/** What every engine type's adapter may share: engine-neutral code, which imports no engine type's. */
export const SHARED_FOLDER = "shared";

/**
 * The Claude Code family: the Agent SDK and `claude -p` both run Claude Code, so they share
 * `claude-code/`, which holds what is Claude Code's alone (its stream's events, its settings, its
 * session files).
 */
const CLAUDE_CODE = "claude-code";
const CLAUDE_CODE_FAMILY: ReadonlySet<string> = new Set(["agent-sdk", "claude-code-p"]);

/**
 * Why a file of one engine type's adapter importing another's breaks the rule, or undefined if it
 * doesn't. A change to one engine type then reaches no other: what they share is in `shared/`.
 * Tests and fixtures may use other engine types' fakes and the scripted engine.
 *
 * @param importerPath - the importer's path in its workspace, with forward slashes.
 * @param targetPath - the imported file's path in the same workspace.
 */
export function engineAdapterViolation(
  importerPath: string,
  importerIsTest: boolean,
  targetPath: string,
): string | undefined {
  const importer = engineAdapterFolderOf(importerPath);
  const target = engineAdapterFolderOf(targetPath);
  if (importerIsTest || importer === undefined || target === undefined || importer === target) {
    return undefined;
  }
  const importerIsEngineType = ENGINE_TYPE_FOLDERS.includes(importer);
  const importerIsShared = importer === SHARED_FOLDER;
  if (!ENGINE_TYPE_FOLDERS.includes(target) || !(importerIsEngineType || importerIsShared)) {
    return undefined;
  }
  if (CLAUDE_CODE_FAMILY.has(importer) && target === CLAUDE_CODE) return undefined;
  return importerIsShared
    ? `engine/adapters/${SHARED_FOLDER}/ is engine-neutral and imports no engine type's adapter, here ${target}/. See the module template in apps/service/docs/module-template.md.`
    : `engine/adapters/${importer}/ imports engine/adapters/${target}/: an engine type's adapter imports only its own folder and ${SHARED_FOLDER}/ (agent-sdk/ and claude-code-p/ also claude-code/), so a change to one engine type reaches no other. Move what both need to ${SHARED_FOLDER}/. See the module template in apps/service/docs/module-template.md.`;
}

function engineAdapterFolderOf(workspacePath: string): string | undefined {
  if (!workspacePath.startsWith(ENGINE_ADAPTERS)) return undefined;
  const [folder, ...rest] = workspacePath.slice(ENGINE_ADAPTERS.length).split("/");
  return rest.length > 0 ? folder : undefined;
}
