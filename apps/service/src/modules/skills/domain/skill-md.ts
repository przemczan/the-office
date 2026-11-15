import { parse, stringify } from "yaml";

/** What a SKILL.md says: its frontmatter, and the instructions after it. */
export interface SkillMd {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly instructions: string;
}

/** The frontmatter block as Claude Code 2.1.310 finds it: `---` lines around YAML, at the top. */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * A top-level `key: value` line whose plain value holds `: `, which YAML refuses but the engine
 * reads as the text after the first `: ` (docs/engine-check.md, `skills.frontmatter-yaml`).
 */
const COLON_IN_VALUE = /^([A-Za-z0-9_-]+):[ \t]+(?!["'[{|>&*!%@`])(.*: .*?)[ \t]*$/;

/**
 * Reads a SKILL.md as the engine does, or returns why it can't be read: frontmatter the engine
 * can't read either would leave the skill listed without its description.
 */
export function readSkillMd(text: string): SkillMd | string {
  const withoutBom = text.replace(/^﻿/, "");
  const match = FRONTMATTER.exec(withoutBom);
  if (!match) {
    return withoutBom.startsWith("---")
      ? "SKILL.md opens its frontmatter with --- but never closes it."
      : { frontmatter: {}, instructions: withoutBom.trim() };
  }
  let frontmatter: unknown;
  try {
    frontmatter = parseFrontmatter(match[1] ?? "");
  } catch (error) {
    return `SKILL.md's frontmatter is not YAML: ${(error as Error).message.split("\n")[0]}`;
  }
  if (typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return "SKILL.md's frontmatter is a list or a single value, not keys and values.";
  }
  return {
    frontmatter: frontmatter as Record<string, unknown>,
    instructions: withoutBom.slice(match[0].length).trim(),
  };
}

function parseFrontmatter(yaml: string): unknown {
  try {
    return parse(yaml, { maxAliasCount: 0 }) ?? {};
  } catch (error) {
    const quoted = yaml
      .split(/\r?\n/)
      .map((line) => {
        const pair = COLON_IN_VALUE.exec(line);
        return pair ? `${pair[1]}: ${JSON.stringify(pair[2])}` : line;
      })
      .join("\n");
    if (quoted === yaml) throw error;
    try {
      return parse(quoted, { maxAliasCount: 0 }) ?? {};
    } catch {
      throw error;
    }
  }
}

/** The SKILL.md of a skill written in The Office. */
export function writtenSkillMd(name: string, description: string, instructions: string): string {
  const frontmatter = stringify({ name, description }, { lineWidth: 0 });
  return `---\n${frontmatter}---\n\n${instructions.trim()}\n`;
}

/** A frontmatter value as text, or undefined when it is missing or not text. */
export function frontmatterText(skillMd: SkillMd, key: string): string | undefined {
  const value = skillMd.frontmatter[key];
  return typeof value === "string" ? value : undefined;
}

/** A frontmatter flag as the engine reads it: on for `true` or the text `"true"`, else off. */
export function frontmatterFlag(skillMd: SkillMd, key: string): boolean {
  const value = skillMd.frontmatter[key];
  return value === true || value === "true";
}

/** Whether only the user runs the skill, as a skill command: `disable-model-invocation: true`. */
export function isUserOnly(skillMd: SkillMd | string): boolean {
  return typeof skillMd !== "string" && frontmatterFlag(skillMd, "disable-model-invocation");
}
