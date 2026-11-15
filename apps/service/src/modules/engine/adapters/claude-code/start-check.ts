import { realpath } from "node:fs";
import { promisify } from "node:util";
import type {
  SDKControlGetContextUsageResponse,
  SDKControlReloadPluginsResponse,
  SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { PathRules } from "../../../../platform/os/path-rules.js";
import { listingProblems } from "../../domain/skill-listing.js";
import type { SessionSkills } from "../../ports/session-options.js";

/** The plugin the Skills module names a session's folder (spec §5.6). */
const SESSION_PLUGIN = "office";

/** The system's own reading of a path, which on Windows turns a short name into the long one. */
const realPath = promisify(realpath.native);

/**
 * The engine's control requests the start check sends, as the SDK's `Query` has them and as the
 * `-p` fallback writes them to the binary's input.
 */
export interface StartCheckRequests {
  reloadPlugins(options: { holdOnCacheImpact: boolean }): Promise<SDKControlReloadPluginsResponse>;
  getContextUsage(options: { detail: "summary" }): Promise<SDKControlGetContextUsageResponse>;
}

interface LoadedPlugin {
  readonly name: string;
  readonly path: string;
}

/**
 * Why a session about to start would not have exactly its skills (spec §5.6), read before any
 * message: the engine sends `init` only with the first, while a plugin reload held on any cache
 * impact and the context usage answer before it (docs/engine-check.md, `skills.start-before-brief`).
 */
export async function startCheckProblems(
  engine: StartCheckRequests,
  skills: SessionSkills | undefined,
  paths: PathRules,
): Promise<string[]> {
  const reload = await engine.reloadPlugins({ holdOnCacheImpact: true });
  const usage = await engine.getContextUsage({ detail: "summary" });
  // The model's listing: a skill only the user runs is never expected, and isn't held against
  // the session should the engine list it anyway.
  const userOnly = new Set(skills?.userOnly ?? []);
  const listed =
    usage.skills?.skillFrontmatter
      .map((skill) => skill.name)
      .filter((name) => !userOnly.has(name)) ?? [];
  return [
    ...(reload.held === true
      ? ["The engine held the plugin reload, which would have changed the cached prompt."]
      : []),
    ...pluginErrorProblems(reload.error_count),
    ...(await sessionPluginProblems(reload.plugins, skills, paths)),
    ...listingProblems(skills?.expected ?? [], listed),
  ];
}

/** Why the `init` the first turn begins with disagrees with what the start check read. */
export async function initProblems(
  init: SDKSystemMessage,
  skills: SessionSkills | undefined,
  paths: PathRules,
): Promise<string[]> {
  return [
    ...pluginErrorProblems(init.plugin_errors?.length ?? 0),
    ...(await sessionPluginProblems(init.plugins, skills, paths)),
  ];
}

function pluginErrorProblems(count: number): string[] {
  if (count === 0) return [];
  return [`The engine reports ${count === 1 ? "a plugin error" : `${count} plugin errors`}.`];
}

async function sessionPluginProblems(
  plugins: readonly LoadedPlugin[],
  skills: SessionSkills | undefined,
  paths: PathRules,
): Promise<string[]> {
  if (skills === undefined) return [];
  for (const plugin of plugins) {
    if (plugin.name === SESSION_PLUGIN && (await samePath(plugin.path, skills.folder, paths))) {
      return [];
    }
  }
  return [
    `The engine didn't load its skills folder ${skills.folder} as the ${SESSION_PLUGIN} plugin.`,
  ];
}

/** One folder may have two names on Windows, a short and a long one. */
async function samePath(first: string, second: string, paths: PathRules): Promise<boolean> {
  const one = await realPath(first).catch(() => first);
  const other = await realPath(second).catch(() => second);
  return paths.isWithin(one, other) && paths.isWithin(other, one);
}
