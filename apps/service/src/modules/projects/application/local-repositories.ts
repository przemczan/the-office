import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { ProjectRefused } from "../domain/project-refused.js";
import { ProjectChecks } from "./project-checks.js";

/** One name at a repository's top level. */
export interface TopLevelEntry {
  readonly name: string;
  readonly kind: "file" | "folder";
}

/** A manifest file at a repository's top level, as much of it as is read. */
export interface ManifestFile {
  readonly name: string;
  readonly text: string;
  /** The file goes on past `text`. */
  readonly cut: boolean;
}

/** What a repository on the workstation holds at its top level. */
export interface LocalRepository {
  readonly entries: readonly TopLevelEntry[];
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

/**
 * Reads a repository on the workstation before it is a Project, for Devops to onboard it from their
 * chat (spec §2.1): its top-level names and its manifest files, never anything below the top level
 * or a file the Agent names, and only a repository's top-level folder, as adding a Project checks.
 */
@Injectable()
export class LocalRepositories {
  constructor(private readonly checks: ProjectChecks) {}

  async read(path: string): Promise<LocalRepository> {
    const problem = await this.checks.repositoryFolderProblem(path);
    if (problem !== undefined) throw new ProjectRefused([problem]);
    const topLevel = (await readdir(path, { withFileTypes: true }))
      .filter(({ name }) => name !== ".git")
      .toSorted((first, second) => first.name.localeCompare(second.name));
    // A link is listed but never followed, so nothing outside the repository is read.
    const manifests = await Promise.all(
      topLevel
        .filter((entry) => entry.isFile() && isManifest(entry.name))
        .map(({ name }) => manifestFile(join(path, name), name)),
    );
    return {
      entries: topLevel.map((entry): TopLevelEntry => ({
        name: entry.name,
        kind: entry.isDirectory() ? "folder" : "file",
      })),
      manifests,
    };
  }
}

function isManifest(name: string): boolean {
  return MANIFEST_NAMES.has(name) || README.test(name);
}

async function manifestFile(filePath: string, name: string): Promise<ManifestFile> {
  const text = await readFile(filePath, "utf8");
  const cut = text.length > MANIFEST_CHARACTERS;
  return { name, text: cut ? text.slice(0, MANIFEST_CHARACTERS) : text, cut };
}
