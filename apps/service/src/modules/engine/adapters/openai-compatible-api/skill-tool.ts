import { readFile } from "node:fs/promises";
import { z } from "zod";
import { SKILL_TOOL, skillNameOf } from "../../domain/skill-calls.js";
import {
  builtInTool,
  failure,
  success,
  type BuiltInTool,
  type ToolOutput,
} from "./built-in-tool.js";
import { fileProblem } from "./file-problems.js";
import type { SkillCommand } from "../../ports/engine-session.js";
import { modelListing, type ListedSkill } from "./listed-skills.js";
import { markdownFile } from "./markdown-file.js";

const skillInput = z.object({
  skill: z.string().min(1).describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
  args: z.string().optional().describe("Optional arguments for the skill"),
});

/** Where a skill's body takes the call's arguments, as Claude Code fills them in. */
const ARGUMENTS_PLACEHOLDER = "$ARGUMENTS";

/**
 * Claude Code's Skill: its description lists the session's skills, and a call loads one by the
 * name listed, its body read as it is now, with the folder its relative paths start from. A skill
 * only the user runs is neither listed nor loaded.
 */
export function skillTool(skills: readonly ListedSkill[]): BuiltInTool {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  return builtInTool({
    name: SKILL_TOOL,
    description: skillToolDescription(modelListing(skills)),
    input: skillInput,
    run: async ({ skill, args }) => {
      const listed = byName.get(skillNameOf(skill));
      if (listed === undefined) return failure(`Unknown skill: ${skill}`);
      if (listed.userOnly) {
        return failure(
          `Skill ${listed.name} can't be used with the ${SKILL_TOOL} tool: only the user runs it, as /${listed.name}.`,
        );
      }
      return loaded(listed, args);
    },
  });
}

/**
 * What a skill command sends the model, as Claude Code expands one: the skill loaded as the Skill
 * tool loads it, with the command's input as its arguments, whether or not the model may use it.
 * Undefined for a skill the session doesn't list or can't read, whose command is sent as written.
 */
export async function skillCommandText(
  skills: readonly ListedSkill[],
  { skill, input }: SkillCommand,
): Promise<string | undefined> {
  const listed = skills.find(({ name }) => name === skillNameOf(skill));
  if (listed === undefined) return undefined;
  const output = await loaded(listed, input);
  return output.isError ? undefined : output.text;
}

function skillToolDescription(skills: readonly ListedSkill[]): string {
  const intro =
    "Execute a skill within the main conversation. When a task matches one of the available skills, load it with this tool before you start, then follow its instructions.";
  if (skills.length === 0) return `${intro}\n\nNo skills are available in this session.`;
  const listing = skills.map(({ name, description }) =>
    description === "" ? `- ${name}` : `- ${name}: ${description}`,
  );
  return `${intro}\n\nAvailable skills:\n${listing.join("\n")}`;
}

async function loaded(skill: ListedSkill, args: string | undefined): Promise<ToolOutput> {
  let text: string;
  try {
    text = await readFile(skill.file, "utf8");
  } catch (error) {
    return failure(`The skill ${skill.name} couldn't be loaded: ${fileProblem(skill.file, error)}`);
  }
  const body = withArguments(markdownFile(text).body.trim(), args?.trim() ?? "");
  return success(
    skill.folder === undefined ? body : `Base directory for this skill: ${skill.folder}\n\n${body}`,
  );
}

function withArguments(body: string, args: string): string {
  if (body.includes(ARGUMENTS_PLACEHOLDER)) return body.replaceAll(ARGUMENTS_PLACEHOLDER, args);
  return args === "" ? body : `${body}\n\nARGUMENTS: ${args}`;
}
