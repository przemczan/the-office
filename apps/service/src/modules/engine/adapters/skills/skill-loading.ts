import { readFile } from "node:fs/promises";
import { z } from "zod";
import { SKILL_TOOL, skillNameOf } from "../../domain/skill-calls.js";
import type { SkillCommand } from "../../ports/engine-session.js";
import { fileProblem } from "./file-problems.js";
import { modelListing, type ListedSkill } from "./listed-skills.js";
import { markdownFile } from "./markdown-file.js";

/** A Skill call's answer: the skill's text, or why it wasn't loaded, for the model to read. */
export type SkillLoading =
  | { readonly loaded: true; readonly text: string }
  | { readonly loaded: false; readonly problem: string };

/** Claude Code's Skill tool's input, whatever way an engine offers the tool. */
export const SKILL_TOOL_INPUT = z.object({
  skill: z.string().min(1).describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
  args: z.string().optional().describe("Optional arguments for the skill"),
});

/** Where a skill's body takes the call's arguments, as Claude Code fills them in. */
const ARGUMENTS_PLACEHOLDER = "$ARGUMENTS";

/**
 * Claude Code's Skill, whatever way an engine calls it: a call loads one of the session's skills
 * by the name listed, its body read as it is now, with the folder its relative paths start from.
 * A skill only the user runs is refused.
 */
export async function skillCalled(
  skills: readonly ListedSkill[],
  name: string,
  args: string | undefined,
): Promise<SkillLoading> {
  const listed = skills.find((skill) => skill.name === skillNameOf(name));
  if (listed === undefined) return { loaded: false, problem: `Unknown skill: ${name}` };
  if (listed.userOnly) {
    return {
      loaded: false,
      problem: `Skill ${listed.name} can't be used with the ${SKILL_TOOL} tool: only the user runs it, as /${listed.name}.`,
    };
  }
  return loadedSkill(listed, args);
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
  const loading = await loadedSkill(listed, input);
  return loading.loaded ? loading.text : undefined;
}

/** The Skill tool's description: what it does, then the skills the model may load. */
export function skillToolDescription(skills: readonly ListedSkill[]): string {
  const intro =
    "Execute a skill within the main conversation. When a task matches one of the available skills, load it with this tool before you start, then follow its instructions.";
  const offered = modelListing(skills);
  if (offered.length === 0) return `${intro}\n\nNo skills are available in this session.`;
  const listing = offered.map(({ name, description }) =>
    description === "" ? `- ${name}` : `- ${name}: ${description}`,
  );
  return `${intro}\n\nAvailable skills:\n${listing.join("\n")}`;
}

async function loadedSkill(skill: ListedSkill, args: string | undefined): Promise<SkillLoading> {
  let text: string;
  try {
    text = await readFile(skill.file, "utf8");
  } catch (error) {
    return {
      loaded: false,
      problem: `The skill ${skill.name} couldn't be loaded: ${fileProblem(skill.file, error)}`,
    };
  }
  const body = withArguments(markdownFile(text).body.trim(), args?.trim() ?? "");
  return {
    loaded: true,
    text:
      skill.folder === undefined
        ? body
        : `Base directory for this skill: ${skill.folder}\n\n${body}`,
  };
}

function withArguments(body: string, args: string): string {
  if (body.includes(ARGUMENTS_PLACEHOLDER)) return body.replaceAll(ARGUMENTS_PLACEHOLDER, args);
  return args === "" ? body : `${body}\n\nARGUMENTS: ${args}`;
}
