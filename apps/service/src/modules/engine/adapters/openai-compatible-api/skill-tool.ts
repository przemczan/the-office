import { SKILL_TOOL } from "../../domain/skill-calls.js";
import type { ListedSkill } from "../skills/listed-skills.js";
import { SKILL_TOOL_INPUT, skillCalled, skillToolDescription } from "../skills/skill-loading.js";
import { builtInTool, failure, success, type BuiltInTool } from "./built-in-tool.js";

/** Claude Code's Skill as a tool of the loop, over the shared skill loading. */
export function skillTool(skills: readonly ListedSkill[]): BuiltInTool {
  return builtInTool({
    name: SKILL_TOOL,
    description: skillToolDescription(skills),
    input: SKILL_TOOL_INPUT,
    run: async ({ skill, args }) => {
      const loading = await skillCalled(skills, skill, args);
      return loading.loaded ? success(loading.text) : failure(loading.problem);
    },
  });
}
