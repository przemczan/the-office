import { isAbsolute, join, relative, sep } from "node:path";
import type { Check } from "../../check.ts";
import { writePlugin, writeSkill } from "../../sandbox.ts";
import { sortedNames } from "../observations.ts";
import { skill } from "./fixtures.ts";
import { pluginErrors } from "./skill-observations.ts";

/**
 * The research read from the 2.1.308 binary that a plugin folder is one plugin when its top level holds
 * `.claude-plugin`, a component folder or a `SKILL.md`, and otherwise a folder of plugins of which only
 * children with a manifest load; a plugin without a manifest is named after its folder.
 */
export const pluginDetectionCheck: Check = {
  id: "skills.plugin-detection",
  title: "how a plugin folder is read: one plugin, or a folder of plugins, and the name without a manifest",
  async run({ sandbox, startSession }) {
    const pluginsRoot = join(sandbox.root, "plugins");
    const withoutManifest = join(pluginsRoot, "without-manifest");
    await writePlugin(withoutManifest, undefined, [skill("one")]);
    const skillAtRoot = join(pluginsRoot, "skill-at-root");
    await writeSkill(skillAtRoot, skill("two"));
    const folderOfPlugins = join(pluginsRoot, "folder-of-plugins");
    await writePlugin(join(folderOfPlugins, "with-manifest"), "child", [skill("three")]);
    await writePlugin(join(folderOfPlugins, "without-manifest"), undefined, [skill("four")]);
    const session = await startSession({
      repository: await sandbox.createRepository(),
      additionalPlugins: [withoutManifest, skillAtRoot, folderOfPlugins],
      options: { skills: "all" },
    });
    const init = await session.initWithoutTurn();
    const usage = await session.control.getContextUsage({ detail: "summary" });
    const underRoot = (path: string): string | undefined => {
      const relativePath = relative(pluginsRoot, path);
      return relativePath.startsWith("..") || isAbsolute(relativePath) ? undefined : relativePath.split(sep).join("/");
    };
    return {
      plugins: sortedNames(
        init.plugins.flatMap((plugin) => {
          const folder = underRoot(plugin.path);
          return folder === undefined ? [] : [`${plugin.name} at ${folder}`];
        }),
      ),
      listedSkills: sortedNames(
        (usage.skills?.skillFrontmatter ?? []).filter((entry) => entry.path !== undefined && underRoot(entry.path) !== undefined).map((entry) => entry.name),
      ),
      pluginErrors: pluginErrors(init),
    };
  },
};
