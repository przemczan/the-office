import type { SkillFixture } from "../../sandbox.ts";

/** A skill whose description has no `: `, so a skill listing line parses back to its name. */
export function skill(name: string, files?: SkillFixture["files"]): SkillFixture {
  return { name, description: `The ${name} skill.`, body: `Reply with the word ${name}.`, ...(files === undefined ? {} : { files }) };
}
