/** One name in a repository's folder. */
export interface FolderEntry {
  readonly name: string;
  readonly kind: "file" | "folder";
}

/** A manifest file in the folder read, as much of it as is read. */
export interface ManifestFile {
  readonly name: string;
  readonly text: string;
  /** The file goes on past `text`. */
  readonly cut: boolean;
}

/** What one folder of a repository holds: its names, and its manifest files' text. */
export interface RepositoryFolder {
  /** The folder read, relative to the repository's top level, with `/` between names; "" for the top level. */
  readonly folder: string;
  readonly entries: readonly FolderEntry[];
  readonly manifests: readonly ManifestFile[];
}

/** The files that say how a repository installs, builds, lints and tests, by stack. */
const MANIFEST_NAMES: ReadonlySet<string> = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "Makefile",
]);

const README = /^readme(\.(md|markdown|rst|txt))?$/i;

/** About 2k tokens per file, so a long README doesn't fill the session. */
export const MANIFEST_CHARACTERS = 8_000;

export function isManifest(name: string): boolean {
  return MANIFEST_NAMES.has(name) || README.test(name);
}

/** The manifest's text, cut to what a session is given. */
export function manifestOf(name: string, text: string): ManifestFile {
  const cut = text.length > MANIFEST_CHARACTERS;
  return { name, text: cut ? text.slice(0, MANIFEST_CHARACTERS) : text, cut };
}

/** Sorted by name, as each way of reading a repository lists its folder. */
export function byName(first: { name: string }, second: { name: string }): number {
  return first.name.localeCompare(second.name);
}
