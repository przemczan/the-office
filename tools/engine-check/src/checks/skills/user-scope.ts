import type { SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import { SESSION_PLUGIN_NAME } from "../../sandbox.ts";
import { sortedNames } from "../observations.ts";
import { skill } from "./fixtures.ts";
import { listedSkillNames, namesSkill, userInvocableNames } from "./skill-observations.ts";

/** What this workstation's `~/.claude` holds, read only: the check never installs or changes anything there. */
interface UserScope {
  readonly installedPlugins: readonly string[];
  readonly skills: readonly string[];
  readonly commands: readonly string[];
  readonly syncedSkills: readonly string[];
  readonly syncedPlugins: readonly string[];
}

type UserScopePart = { readonly present: boolean; readonly loaded: string[] };

/**
 * Whether what the user installed or synced reaches a session under `settingSources: ['project']`
 * with the Office's settings. Each part records whether this workstation has any, since a part with
 * nothing present proves nothing.
 */
export const userScopeCheck: Check = {
  id: "skills.user-scope",
  title:
    "user-scope installed plugins, skills and already-synced skills under settingSources ['project']",
  async run({ sandbox, startSession }) {
    const userScope = await readUserScope(join(homedir(), ".claude"));
    const session = await startSession({
      repository: await sandbox.createRepository(),
      skills: [skill("alpha")],
    });
    const init = await session.initWithoutTurn();
    const skillNamesSeen = [
      ...init.skills,
      ...(await userInvocableNames(session)),
      ...(await listedSkillNames(session)),
    ];
    const loadedSkills = (names: readonly string[]): string[] =>
      sortedNames(names.filter((name) => skillNamesSeen.some((seen) => namesSkill(seen, name))));
    const pluginsLoaded = userPluginNames(init);
    const loadedPlugins = (names: readonly string[]): string[] =>
      sortedNames(names.filter((name) => pluginsLoaded.includes(name)));
    return {
      installedPlugins: part(userScope.installedPlugins, loadedPlugins),
      skills: part(userScope.skills, loadedSkills),
      commands: part(userScope.commands, loadedSkills),
      syncedSkills: part(userScope.syncedSkills, loadedSkills),
      syncedPlugins: part(userScope.syncedPlugins, loadedPlugins),
    };
  },
};

function part(
  present: readonly string[],
  loaded: (names: readonly string[]) => string[],
): UserScopePart {
  return { present: present.length > 0, loaded: loaded(present) };
}

/** Loaded plugins other than the session plugin and Claude Code's built-in ones. */
function userPluginNames(init: SDKSystemMessage): string[] {
  return init.plugins
    .filter((plugin) => plugin.name !== SESSION_PLUGIN_NAME && plugin.path !== "builtin")
    .map((plugin) => plugin.name);
}

async function readUserScope(claudeFolder: string): Promise<UserScope> {
  const syncedSkillsFolder = join(claudeFolder, "skills", "synced");
  const syncedPluginsFolder = join(claudeFolder, "plugins", "synced");
  return {
    installedPlugins: await installedPluginNames(
      join(claudeFolder, "plugins", "installed_plugins.json"),
    ),
    skills: (await entryNames(join(claudeFolder, "skills"))).filter((name) => name !== "synced"),
    commands: (await entryNames(join(claudeFolder, "commands")))
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -3)),
    syncedSkills: await namesPerAccount(syncedSkillsFolder),
    // A synced plugin folder is named `<plugin>~<revision>`.
    syncedPlugins: (await namesPerAccount(syncedPluginsFolder)).map(
      (name) => name.split("~")[0] as string,
    ),
  };
}

/** Plugin names from the `<name>@<marketplace>` ids of installed plugins. */
async function installedPluginNames(path: string): Promise<string[]> {
  const text = await readFile(path, "utf8").catch(() => "{}");
  const installed = JSON.parse(text) as { plugins?: Record<string, unknown> };
  return Object.keys(installed.plugins ?? {}).map((id) => id.split("@")[0] as string);
}

/** Synced skills and plugins sit in one folder per claude.ai account. */
async function namesPerAccount(syncedFolder: string): Promise<string[]> {
  const accounts = await folderNames(syncedFolder);
  return (
    await Promise.all(accounts.map((account) => folderNames(join(syncedFolder, account))))
  ).flat();
}

/** Every entry, links included: user skills are often links into another folder. */
async function entryNames(folder: string): Promise<string[]> {
  return readdir(folder).catch(() => []);
}

async function folderNames(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}
