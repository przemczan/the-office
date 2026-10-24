import type { Check } from "../../check.ts";
import { SESSION_PLUGIN_NAME } from "../../sandbox.ts";
import { sortedNames } from "../observations.ts";
import { samePath } from "../paths.ts";
import { skill } from "./fixtures.ts";
import { listedSkillNames, pluginErrors } from "./skill-observations.ts";

const SESSION_SKILLS = [skill("alpha"), skill("beta")];

/** The check the Engine adapter makes before a session may start (spec §5.6). */
export const startCheck: Check = {
  id: "skills.start-check",
  title: "init lists the session plugin without errors, and the listing holds exactly the session's skills",
  async run({ sandbox, startSession }) {
    const session = await startSession({ repository: await sandbox.createRepository(), skills: SESSION_SKILLS });
    const init = await session.initWithoutTurn();
    const sessionSkills = SESSION_SKILLS.map((skill) => `${SESSION_PLUGIN_NAME}:${skill.name}`).sort();
    const listed = await listedSkillNames(session);
    return {
      sessionPluginAtItsFolder: init.plugins.some(
        (plugin) => plugin.name === SESSION_PLUGIN_NAME && samePath(plugin.path, session.pluginFolder),
      ),
      pluginErrors: pluginErrors(init),
      listedSkills: listed,
      listingEqualsSessionSkills: JSON.stringify(listed) === JSON.stringify(sessionSkills),
      // Engine-version facts: built-in plugins load beside the session plugin, and `init.skills` is not filtered by the allowlist.
      otherPlugins: sortedNames(init.plugins.filter((plugin) => plugin.name !== SESSION_PLUGIN_NAME).map((plugin) => plugin.name)),
      initSkillsOutsideSession: sortedNames(init.skills.filter((name) => !sessionSkills.includes(name))),
    };
  },
};
