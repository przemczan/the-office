import { readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { z } from "zod";
import type { SessionSkills } from "../../ports/session-options.js";
import { isMissing } from "./file-problems.js";
import { parsedJson } from "./json-text.js";
import {
  frontmatterText,
  isUserOnly,
  markdownFile,
  markdownFilesIn,
  textOrNone,
} from "./markdown-file.js";

/** A skill or command the session lists, which its Skill tool loads by name. */
export interface ListedSkill {
  /** As the listing names it, and the Skill tool takes it. */
  readonly name: string;
  readonly description: string;
  /** Its `SKILL.md`, or the command's file. */
  readonly file: string;
  /** A skill's folder, which its body's relative paths start from; undefined for a command. */
  readonly folder: string | undefined;
  /**
   * Only the user runs it, as a skill command (`disable-model-invocation: true`): the model's
   * listing leaves it out and its Skill tool refuses it.
   */
  readonly userOnly: boolean;
}

const SKILL_MD = "SKILL.md";

const pluginManifestSchema = z.object({ name: z.string().min(1) });

/**
 * What a session lists at its start, as Claude Code lists it under the SDK adapter's options
 * (spec §5.6): each skill of the session's plugin folder as `<plugin>:<folder>`, and the Project's
 * skills (`.claude/skills/<folder>/SKILL.md`, by their frontmatter name or else their folder's) and
 * commands (`.claude/commands/**.md`, by their path with `:` between folders) at the top of the
 * session's folder that the allowlist names. Nested ones are left out, as the engine lists them
 * only once a file below them is read. In name order. Those only the user runs are among them,
 * flagged, for skill commands; the model's listing is `modelListing`'s.
 */
export async function listedSkills(
  folder: string,
  skills: SessionSkills | undefined,
): Promise<ListedSkill[]> {
  if (skills === undefined) return [];
  const allowed = new Set(skills.names.filter((name) => skills.overrides[name] !== "off"));
  const listed = [
    ...(await pluginSkills(skills.folder)),
    ...(await projectSkills(folder))
      .filter(({ key }) => allowed.has(key))
      .map(({ skill }) => skill),
  ];
  return listed.toSorted((first, second) => (first.name < second.name ? -1 : 1));
}

/** What the model is offered, as the start check compares it: none only the user runs. */
export function modelListing(skills: readonly ListedSkill[]): ListedSkill[] {
  return skills.filter((skill) => !skill.userOnly);
}

/** The plugin's skills, named after the plugin its manifest names. */
async function pluginSkills(pluginFolder: string): Promise<ListedSkill[]> {
  const manifestText = await textOrNone(join(pluginFolder, ".claude-plugin", "plugin.json"));
  const manifest = pluginManifestSchema.safeParse(
    manifestText === undefined ? undefined : parsedJson(manifestText),
  );
  if (!manifest.success) return [];
  const skillsFolder = join(pluginFolder, "skills");
  const listed: ListedSkill[] = [];
  for (const name of await folderNames(skillsFolder)) {
    const skill = await skillIn(join(skillsFolder, name), `${manifest.data.name}:${name}`);
    if (skill) listed.push(skill);
  }
  return listed;
}

/** A Project skill or command, with the key the allowlist and `skillOverrides` match it by. */
interface ProjectSkill {
  readonly key: string;
  readonly skill: ListedSkill;
}

async function projectSkills(folder: string): Promise<ProjectSkill[]> {
  const found: ProjectSkill[] = [];
  const skillsFolder = join(folder, ".claude", "skills");
  for (const name of await folderNames(skillsFolder)) {
    const skill = await skillIn(join(skillsFolder, name), undefined);
    if (skill) found.push({ key: name, skill });
  }
  const commandsFolder = join(folder, ".claude", "commands");
  for (const file of await markdownFilesIn(commandsFolder)) {
    const text = await textOrNone(file);
    if (text === undefined) continue;
    const key = relative(commandsFolder, file).slice(0, -".md".length).split(sep).join(":");
    found.push({
      key,
      skill: {
        name: key,
        description: description(text),
        file,
        folder: undefined,
        userOnly: isUserOnly(markdownFile(text)),
      },
    });
  }
  return found;
}

/** The skill whose `SKILL.md` is in `skillFolder`, named `name` or else by its frontmatter. */
async function skillIn(
  skillFolder: string,
  name: string | undefined,
): Promise<ListedSkill | undefined> {
  const file = join(skillFolder, SKILL_MD);
  const text = await textOrNone(file);
  if (text === undefined) return undefined;
  return {
    name: name ?? frontmatterText(markdownFile(text), "name") ?? basename(skillFolder),
    description: description(text),
    file,
    folder: skillFolder,
    userOnly: isUserOnly(markdownFile(text)),
  };
}

/** The frontmatter's description, or else the body's first line, as Claude Code lists one. */
function description(text: string): string {
  const file = markdownFile(text);
  const firstLine = file.body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line !== "");
  return frontmatterText(file, "description") ?? firstLine ?? "";
}

async function folderNames(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(missingAsNone);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function missingAsNone(error: unknown): never[] {
  if (isMissing(error)) return [];
  throw error;
}
