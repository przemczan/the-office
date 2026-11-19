import { z } from "zod";
import { SKILL_TOOL } from "../../domain/skill-calls.js";
import type { ListedSkill } from "../skills/listed-skills.js";
import { skillCalled, skillToolDescription } from "../skills/skill-loading.js";
import { builtInTool, failure, success, type BuiltInTool } from "./built-in-tool.js";

const skillInput = z.object({
  skill: z.string().min(1).describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
  args: z.string().optional().describe("Optional arguments for the skill"),
});

/** Claude Code's Skill as a tool of the loop, over the shared skill loading. */
export function skillTool(skills: readonly ListedSkill[]): BuiltInTool {
  return builtInTool({
    name: SKILL_TOOL,
    description: skillToolDescription(skills),
    input: skillInput,
    run: async ({ skill, args }) => {
      const loading = await skillCalled(skills, skill, args);
      return loading.loaded ? success(loading.text) : failure(loading.problem);
    },
  });
}
