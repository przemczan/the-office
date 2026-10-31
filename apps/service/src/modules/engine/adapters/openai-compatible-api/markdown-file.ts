import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { isMissing } from "./file-problems.js";

/** A Markdown file as Claude Code reads a skill, a command or a rule: its frontmatter, then the rest. */
export interface MarkdownFile {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Frontmatter that isn't a YAML mapping is read as none, the file's text then all body. */
export function markdownFile(text: string): MarkdownFile {
  const found = FRONTMATTER.exec(text);
  if (found === null) return { frontmatter: {}, body: text };
  const frontmatter = parsedMapping(found[1] ?? "");
  if (frontmatter === undefined) return { frontmatter: {}, body: text };
  return { frontmatter, body: text.slice(found[0].length) };
}

/** A frontmatter value as text, or undefined when it is missing, empty or not text. */
export function frontmatterText(file: MarkdownFile, key: string): string | undefined {
  const value = file.frontmatter[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parsedMapping(yaml: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = parse(yaml);
    if (value === null || value === undefined) return {};
    return typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The Markdown files below `folder`, at any depth, in path order; none when it is missing. */
export async function markdownFilesIn(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true, recursive: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(entry.parentPath, entry.name))
      .toSorted();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** The file's text, or undefined when it is missing. */
export async function textOrNone(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}
