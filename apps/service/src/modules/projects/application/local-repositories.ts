import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Injectable } from "@nestjs/common";
import { ProjectRefused } from "../domain/project-refused.js";
import { Git, type LocalBranch } from "../ports/git.js";
import { ProjectChecks } from "./project-checks.js";

/** One name in the folder read. */
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

/** What a repository on the workstation holds in one of its folders, and its branches. */
export interface LocalRepository {
  /** The folder read, relative to the repository's top level, with `/` between names; "" for the top level. */
  readonly folder: string;
  readonly entries: readonly FolderEntry[];
  readonly manifests: readonly ManifestFile[];
  readonly branches: readonly LocalBranch[];
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
 * chat (spec §2.1): its local branches, and the names and manifest files of its top-level folder or
 * of one folder inside it, never a file the Agent names, and only a repository's top-level folder, as
 * adding a Project checks. Nothing outside the repository is read, through a link either.
 */
@Injectable()
export class LocalRepositories {
  constructor(
    private readonly checks: ProjectChecks,
    private readonly git: Git,
  ) {}

  async read(path: string, folder = ""): Promise<LocalRepository> {
    const problem = await this.checks.repositoryFolderProblem(path);
    if (problem !== undefined) throw new ProjectRefused([problem]);
    const target = await folderInside(path, folder);
    const names = (await readdir(target, { withFileTypes: true }))
      .filter(({ name }) => name !== ".git")
      .toSorted((first, second) => first.name.localeCompare(second.name));
    // A link is listed but never followed.
    const manifests = await Promise.all(
      names
        .filter((entry) => entry.isFile() && isManifest(entry.name))
        .map(({ name }) => manifestFile(join(target, name), name)),
    );
    return {
      folder: relative(path, target).split(sep).join("/"),
      entries: names.map((entry): FolderEntry => ({
        name: entry.name,
        kind: entry.isDirectory() ? "folder" : "file",
      })),
      manifests,
      branches: await this.git.localBranches(path),
    };
  }
}

/** The folder `folder` names inside the repository at `path`, refused when it leaves it or is git's own. */
async function folderInside(path: string, folder: string): Promise<string> {
  if (isAbsolute(folder)) {
    throw new ProjectRefused([
      `Give the folder relative to the repository's top level, not as a full path: ${folder}.`,
    ]);
  }
  const target = resolve(path, folder);
  if (!isWithin(target, path) || relative(path, target).split(sep).includes(".git")) {
    throw new ProjectRefused([`${folder} is not a folder inside the repository.`]);
  }
  const found = await stat(target).catch(() => undefined);
  if (found === undefined) throw new ProjectRefused([`The repository has no folder ${folder}.`]);
  if (!found.isDirectory()) throw new ProjectRefused([`${folder} is a file, not a folder.`]);
  // A link inside the repository may lead out of it.
  const [realRepository, realTarget] = await Promise.all([realpath(path), realpath(target)]);
  if (!isWithin(realTarget, realRepository)) {
    throw new ProjectRefused([`${folder} leads outside the repository.`]);
  }
  return target;
}

function isWithin(path: string, folder: string): boolean {
  const inside = relative(folder, path);
  // On Windows a path on another drive comes back absolute.
  return inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

function isManifest(name: string): boolean {
  return MANIFEST_NAMES.has(name) || README.test(name);
}

async function manifestFile(filePath: string, name: string): Promise<ManifestFile> {
  const text = await readFile(filePath, "utf8");
  const cut = text.length > MANIFEST_CHARACTERS;
  return { name, text: cut ? text.slice(0, MANIFEST_CHARACTERS) : text, cut };
}
