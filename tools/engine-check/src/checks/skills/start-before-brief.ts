import type { Check } from "../../check.ts";
import { SESSION_PLUGIN_NAME } from "../../sandbox.ts";
import { readTranscript, skillListings } from "../../transcripts.ts";
import { sortedNames } from "../observations.ts";
import { samePath } from "../paths.ts";
import { skill } from "./fixtures.ts";
import { listedSkillNames, pluginErrors } from "./skill-observations.ts";

const SESSION_SKILLS = [skill("alpha")];

/**
 * What the Engine adapter can read of a new session before its brief starts the first turn, so
 * the start check of spec §5.6 refuses a session before any model call; then one turn, to see
 * the reading left nothing in the conversation.
 */
export const startBeforeBriefCheck: Check = {
  id: "skills.start-before-brief",
  title: "the plugins and the skill listing before the first message, and what that leaves",
  async run({ sandbox, startSession }) {
    const session = await startSession({
      repository: await sandbox.createRepository(),
      skills: SESSION_SKILLS,
    });
    const reload = await session.control.reloadPlugins({ holdOnCacheImpact: true });
    const listedBeforeAnyMessage = await listedSkillNames(session);
    const initBeforeAnyMessage = session.messages.some(
      (message) => message.type === "system" && message.subtype === "init",
    );
    session.send("Reply with just OK.");
    const init = await session.init();
    await session.nextResult();
    const transcript = await readTranscript(session.repository, session.sessionId);
    return {
      initBeforeAnyMessage,
      reloadPlugins: sortedNames(reload.plugins.map((plugin) => plugin.name)),
      reloadSessionPluginAtItsFolder: reload.plugins.some(
        (plugin) =>
          plugin.name === SESSION_PLUGIN_NAME && samePath(plugin.path, session.pluginFolder),
      ),
      reloadErrorCount: reload.error_count,
      reloadHeld: reload.held ?? null,
      listedBeforeAnyMessage,
      initPlugins: sortedNames(init.plugins.map((plugin) => plugin.name)),
      initPluginErrors: pluginErrors(init),
      userEntries: transcript.filter((entry) => entry.type === "user").length,
      skillListings: skillListings(transcript),
    };
  },
};
