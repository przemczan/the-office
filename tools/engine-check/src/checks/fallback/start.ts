import type { Check } from "../../check.ts";
import { OFFICE_TOOLS, officeToolName } from "../../office-options.ts";
import { SESSION_PLUGIN_NAME, writeProjectSkill } from "../../sandbox.ts";
import { sortedNames } from "../observations.ts";
import { samePath } from "../paths.ts";
import { skill } from "../skills/fixtures.ts";
import { pluginErrors } from "../skills/skill-observations.ts";
import { HANDOVER_NOTE, handoverNoteTool } from "./office-tools.ts";
import { requestsToHost, usageWindows } from "./observations.ts";

const SESSION_SKILLS = [skill("alpha"), skill("beta")];
/** Project skills: one the Role has, one turned off; `-p` has no allowlist, so only the override hides it. */
const PROJECT_SKILLS = { kept: "lint", off: "deploy" } as const;

/**
 * The fallback's start without a model call (spec §5.4 Defaults, §5.6): the pinned binary in `-p`,
 * the Office tools through the binary's stream, exactly the session's skills by ticket 22's flags
 * and the SDK adapter's start check, the lean options of §5.4 as flags and settings, and the
 * control requests behind the context usage and usage windows capabilities.
 */
export const fallbackStartCheck: Check = {
  id: "fallback.start",
  title:
    "the pinned binary in -p starts with exactly the session's skills, the Office tools through its stream and the lean options",
  async run({ sandbox, startClaudeCodePSession }) {
    const repository = await sandbox.createRepository();
    for (const name of Object.values(PROJECT_SKILLS)) {
      await writeProjectSkill(repository, skill(name));
    }
    const session = await startClaudeCodePSession({
      repository,
      skills: SESSION_SKILLS,
      allowedSkills: [
        ...SESSION_SKILLS.map((sessionSkill) => `${SESSION_PLUGIN_NAME}:${sessionSkill.name}`),
        PROJECT_SKILLS.kept,
      ],
      settings: { skillOverrides: { [PROJECT_SKILLS.off]: "off" } },
      officeTools: [handoverNoteTool([])],
    });
    // The SDK adapter's start check, before any message (skills.start-before-brief).
    const reload = await session.reloadPlugins();
    const contextUsage = await session.getContextUsage();
    const init = await session.initWithoutTurn();
    const usage = await session.usage();
    const officeTool = officeToolName(HANDOVER_NOTE);
    return {
      claudeCodeVersion: init.claude_code_version,
      sessionIdKept: init.session_id === session.sessionId,
      startCheck: {
        held: reload.held === true,
        pluginErrors: reload.error_count,
        sessionPluginAtItsFolder: reload.plugins.some(
          (plugin) =>
            plugin.name === SESSION_PLUGIN_NAME && samePath(plugin.path, session.pluginFolder),
        ),
        listedSkills: sortedNames(
          contextUsage.skills?.skillFrontmatter.map((listed) => listed.name) ?? [],
        ),
      },
      init: {
        sessionPluginAtItsFolder: init.plugins.some(
          (plugin) =>
            plugin.name === SESSION_PLUGIN_NAME && samePath(plugin.path, session.pluginFolder),
        ),
        pluginErrors: pluginErrors(init),
        otherPlugins: sortedNames(
          init.plugins
            .filter((plugin) => plugin.name !== SESSION_PLUGIN_NAME)
            .map((plugin) => plugin.name),
        ),
        toolsBeyondOffice: sortedNames(
          init.tools.filter((tool) => !OFFICE_TOOLS.includes(tool) && tool !== officeTool),
        ),
        officeToolsMissing: sortedNames(
          [...OFFICE_TOOLS, officeTool].filter((tool) => !init.tools.includes(tool)),
        ),
        mcpServers: Object.fromEntries(
          init.mcp_servers.map((server) => [server.name, server.status]),
        ),
        autoMemoryFolder:
          (init as { memory_paths?: { auto?: string } }).memory_paths?.auto !== undefined,
      },
      contextUsage: {
        answered: typeof contextUsage.totalTokens === "number",
        memoryFiles: sortedNames(contextUsage.memoryFiles.map((file) => file.type)),
        memoryFileTokens:
          contextUsage.categories.find((category) => category.id === "memory_files")?.tokens ?? 0,
      },
      usageWindows: usageWindows(usage),
      officeToolMethods: [...new Set(session.officeToolMethods)],
      requestsToHost: requestsToHost(session),
    };
  },
};
