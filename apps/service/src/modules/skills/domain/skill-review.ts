import { sortedByPath, type SkillFile } from "./skill-files.js";
import { skillMdOf } from "./skill-draft.js";

/** A file as Review shows it. */
export interface ReviewedFile {
  readonly path: string;
  /** Undefined for a file that is no UTF-8 text. */
  readonly text: string | undefined;
  /** Runs with the permissions of whoever uses the skill. */
  readonly script: boolean;
}

/** What the user reads before turning a skill on (spec §2.6, §9). */
export interface SkillReview {
  readonly files: readonly ReviewedFile[];
  /** SKILL.md's instructions, after its frontmatter. */
  readonly instructions: string;
  /** What in the files changes a session beyond its instructions, in the UI's words. */
  readonly warnings: readonly string[];
}

const SCRIPT_EXTENSIONS =
  /\.(?:sh|bash|zsh|fish|ps1|psm1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|php|exe|dll|so|dylib)$/i;

/** Frontmatter keys that only describe the skill or how it is called. */
const INERT_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "version",
  "argument-hint",
  "arguments",
  "user-invocable",
  "paths",
]);

/** Frontmatter keys that change a session, with what they do to it (Claude Code 2.1.310). */
const SESSION_KEYS: Readonly<Record<string, string>> = {
  hooks:
    "sets hooks: commands the engine runs while the skill is in use, which The Office's rules never see",
  model:
    "changes the model while the skill is in use, which makes the session pay its whole prompt again",
  effort:
    "changes the effort while the skill is in use, which makes the session pay its whole prompt again",
  "allowed-tools":
    "changes which tools are allowed while the skill is in use; The Office's rules still decide each call",
  "disallowed-tools": "changes which tools are refused while the skill is in use",
  disallowedTools: "changes which tools are refused while the skill is in use",
  context: "runs the skill in a subagent",
  agent: "runs the skill as a subagent of its own",
  shell: "picks the shell for commands in its text, which sessions don't run",
  when_to_use:
    "adds when_to_use, which every session that has the skill lists besides its description",
  "when-to-use":
    "adds when-to-use, which every session that has the skill lists besides its description",
  "disable-model-invocation":
    "keeps the model from using it, so a session that has it is refused at its start",
};

/** Commands a skill's text asks the engine to run as it loads, as the engine finds them. */
const SHELL_BLOCKS = [/```!\s*\n?[\s\S]*?\n?```/, /(?:^|\s)!`[^`]+`/m];

export function reviewOf(files: readonly SkillFile[]): SkillReview {
  const reviewed = sortedByPath(files).map(reviewedFile);
  const skillMd = skillMdOf(files);
  const warnings: string[] = [];
  const scripts = reviewed.filter((file) => file.script).length;
  if (scripts > 0) {
    warnings.push(
      `It includes ${scripts === 1 ? "a script" : `${scripts} scripts`}. Scripts run with the permissions of whoever uses the skill.`,
    );
  }
  const keys = Object.keys(skillMd.frontmatter);
  for (const key of keys) {
    const effect = SESSION_KEYS[key];
    const turnedOff = key === "disable-model-invocation" && !skillMd.frontmatter[key];
    if (effect && !turnedOff) warnings.push(`Its frontmatter ${effect}.`);
  }
  const unknown = keys.filter((key) => !INERT_KEYS.has(key) && !(key in SESSION_KEYS));
  if (unknown.length > 0) {
    warnings.push(`Its frontmatter has keys The Office doesn't know: ${unknown.join(", ")}.`);
  }
  if (SHELL_BLOCKS.some((block) => block.test(skillMd.instructions))) {
    warnings.push(
      "Its instructions hold commands meant to run as it loads; sessions don't run them.",
    );
  }
  return { files: reviewed, instructions: skillMd.instructions, warnings };
}

function reviewedFile(file: SkillFile): ReviewedFile {
  const text = utf8Text(file.content);
  return {
    path: file.path,
    text,
    script: SCRIPT_EXTENSIONS.test(file.path) || (text?.startsWith("#!") ?? false),
  };
}

function utf8Text(content: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}
