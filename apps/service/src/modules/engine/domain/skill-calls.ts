/** Claude Code's tool that loads a skill by name, which the API engine's loop offers under the same name. */
export const SKILL_TOOL = "Skill";

/** The model may write a skill's name as the user invokes it, `/name`, which names the same skill. */
export function skillNameOf(written: string): string {
  return written.replace(/^\//, "");
}

/** The skill a tool call loads, by its name without a leading `/`, or undefined for any other call. */
export function calledSkill(tool: string, input: unknown): string | undefined {
  if (tool !== SKILL_TOOL || typeof input !== "object" || input === null) return undefined;
  const skill: unknown = (input as { readonly skill?: unknown }).skill;
  if (typeof skill !== "string") return undefined;
  const name = skillNameOf(skill);
  return name === "" ? undefined : name;
}
