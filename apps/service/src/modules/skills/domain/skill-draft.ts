import {
  newSkillProblems,
  skillDescriptionProblems,
  skillNameProblems,
  type NewSkill,
  type SkillSource,
} from "./skill.js";
import { SKILL_MD, skillFilesProblems, type SkillFile } from "./skill-files.js";
import { frontmatterText, readSkillMd, writtenSkillMd, type SkillMd } from "./skill-md.js";
import { SkillRefused } from "./skill-refused.js";

/** A version as the Write form or an upload gives it, before the library keeps it. */
export interface SkillDraft {
  readonly skill: NewSkill;
  readonly files: readonly SkillFile[];
}

/** What the Write form gives, for a new skill or the next version of a written one. */
export interface WrittenSkill {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

/** A skill written in The Office: one SKILL.md. Refuses with every reason. */
export function writtenDraft(written: WrittenSkill): SkillDraft {
  const skill: NewSkill = {
    name: written.name.trim(),
    description: written.description.trim(),
    source: "written",
  };
  const problems = newSkillProblems(skill);
  if (written.instructions.trim() === "") problems.push("Give the skill its instructions.");
  if (problems.length > 0) throw new SkillRefused(problems);
  const text = writtenSkillMd(skill.name, skill.description, written.instructions);
  return { skill, files: [{ path: SKILL_MD, content: new TextEncoder().encode(text) }] };
}

/**
 * A skill from uploaded files. Its SKILL.md names it, or else `fallbackName` does, as the engine
 * names a skill by its folder; that SKILL.md describes it. Refuses with every reason.
 */
export function uploadedDraft(
  fallbackName: string,
  source: Exclude<SkillSource, "written">,
  files: readonly SkillFile[],
): SkillDraft {
  const problems = skillFilesProblems(files);
  if (problems.length > 0) throw new SkillRefused(problems);
  const skillMd = skillMdOf(files);
  const named = skillMd.frontmatter["name"];
  if (named !== undefined && typeof named !== "string") {
    throw new SkillRefused(["The name in SKILL.md's frontmatter is not text."]);
  }
  const name = named?.trim() ?? fallbackName;
  const description = frontmatterText(skillMd, "description")?.trim() ?? "";
  const skill: NewSkill = { name, description, source };
  const refusals = [
    ...skillNameProblems(name).map((problem) =>
      named === undefined ? problem : `SKILL.md's frontmatter names it "${name}": ${problem}`,
    ),
    ...(description === ""
      ? ["SKILL.md's frontmatter gives no description: when to use it, in one sentence."]
      : skillDescriptionProblems(description)),
  ];
  if (refusals.length > 0) throw new SkillRefused(refusals);
  return { skill, files };
}

/** Refuses a next version that names another skill. */
export function checkSameSkill(draft: SkillDraft, skillName: string): void {
  if (draft.skill.name !== skillName) {
    throw new SkillRefused([`It names the skill ${draft.skill.name}, not ${skillName}.`]);
  }
}

/** The files' SKILL.md, read; refuses when it is no UTF-8 text or its frontmatter can't be read. */
export function skillMdOf(files: readonly SkillFile[]): SkillMd {
  const file = files.find((candidate) => candidate.path === SKILL_MD);
  if (!file) throw new SkillRefused([`A skill has a ${SKILL_MD} at the top of its folder.`]);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
  } catch {
    throw new SkillRefused(["SKILL.md is not UTF-8 text."]);
  }
  const skillMd = readSkillMd(text);
  if (typeof skillMd === "string") throw new SkillRefused([skillMd]);
  return skillMd;
}

/** A name for a skill from the name of the file or folder it came in. */
export function nameFromFileName(fileName: string): string {
  return fileName
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\.(?:md|zip)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
