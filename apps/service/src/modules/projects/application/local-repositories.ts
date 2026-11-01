import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Injectable } from "@nestjs/common";
import { ProjectRefused } from "../domain/project-refused.js";
import { Git, type LocalBranch } from "../ports/git.js";
import { ProjectChecks } from "./project-checks.js";
import {
  byName,
  isManifest,
  manifestOf,
  type FolderEntry,
  type ManifestFile,
  type RepositoryFolder,
} from "./repository-folder.js";

/** What a repository on the workstation holds in one of its folders, and its branches. */
export interface LocalRepository extends RepositoryFolder {
  readonly branches: readonly LocalBranch[];
}

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
      .toSorted(byName);
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

async function manifestFile(filePath: string, name: string): Promise<ManifestFile> {
  return manifestOf(name, await readFile(filePath, "utf8"));
}
