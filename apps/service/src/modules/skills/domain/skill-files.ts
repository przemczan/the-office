import { createHash } from "node:crypto";

/** A file of a skill version, at its path inside the skill's folder. */
export interface SkillFile {
  /** Relative to the skill's folder, with `/` between folders on every system. */
  readonly path: string;
  readonly content: Uint8Array;
}

/** The file every skill has at the top of its folder: its frontmatter and instructions. */
export const SKILL_MD = "SKILL.md";

/** Characters Windows refuses in a file name, besides `/` and `\`, which separate folders. */
const UNPORTABLE = /[<>:"|?*\p{Cc}]/u;
const DEVICE_NAMES = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Whether Windows keeps the name for a device, whatever its extension: `nul` and `NUL.txt` alike. */
export function isWindowsDeviceName(name: string): boolean {
  return DEVICE_NAMES.test(name.split(".")[0] ?? "");
}

/**
 * Identifies a version by its files alone, the same on every system: each path, sorted by its
 * characters, with the SHA-256 of its exact bytes. Paths and contents can't run into each other.
 */
export function skillFilesHash(files: readonly SkillFile[]): string {
  const hash = createHash("sha256");
  for (const file of sortedByPath(files)) {
    hash.update(`${file.path}\0${createHash("sha256").update(file.content).digest("hex")}\n`);
  }
  return hash.digest("hex");
}

/** The files in path order, comparing characters rather than by locale. */
export function sortedByPath(files: readonly SkillFile[]): SkillFile[] {
  return files.toSorted((first, second) =>
    first.path < second.path ? -1 : first.path > second.path ? 1 : 0,
  );
}

/**
 * Why a file can't be kept at `path` in a skill's folder; undefined when it can. A path stays
 * inside the folder and names a file on Windows and Linux alike.
 */
export function skillFilePathProblem(path: string): string | undefined {
  const outside = `A skill's files stay inside its folder; "${path}" is not inside.`;
  if (path === "" || path.startsWith("/") || path.includes("\\") || /^[a-z]:/i.test(path)) {
    return outside;
  }
  const names = path.split("/");
  if (names.some((name) => name === "" || name === "." || name === "..")) return outside;
  if (
    names.some((name) => UNPORTABLE.test(name) || /[. ]$/.test(name) || isWindowsDeviceName(name))
  ) {
    return `"${path}" can't be a file name on Windows.`;
  }
  return undefined;
}

/** Why `files` can't be one version of a skill, with every reason. */
export function skillFilesProblems(files: readonly SkillFile[]): string[] {
  const problems = files.flatMap((file) => skillFilePathProblem(file.path) ?? []);
  // Windows and macOS keep `Notes.md` and `notes.md` as one file.
  const paths = files.map((file) => file.path.toLowerCase());
  if (new Set(paths).size !== paths.length) {
    problems.push("Two of the skill's files have the same path, ignoring case.");
  }
  const folders = new Set(paths.flatMap(foldersOf));
  for (const file of files) {
    if (folders.has(file.path.toLowerCase())) {
      problems.push(`"${file.path}" is both a file and a folder.`);
    }
  }
  if (!files.some((file) => file.path === SKILL_MD)) {
    problems.push(`A skill has a ${SKILL_MD} at the top of its folder.`);
  }
  return problems;
}

/** The folders a path is in: `a` and `a/b` for `a/b/c.md`. */
function foldersOf(path: string): string[] {
  const names = path.split("/").slice(0, -1);
  return names.map((_, index) => names.slice(0, index + 1).join("/"));
}
