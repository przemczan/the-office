import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
import { LocalRepositories, type LocalRepository } from "../../application/local-repositories.js";
import { ProjectRecords } from "../../application/project-records.js";
import { RepositoriesByUrl, type RepositoryByUrl } from "../../application/repositories-by-url.js";
import type { ManifestFile, RepositoryFolder } from "../../application/repository-folder.js";
import type { LocalBranch } from "../../ports/git.js";
import { ProjectRefused } from "../../domain/project-refused.js";

export const LIST_PROJECTS = "list_projects";
export const READ_REPOSITORY = "read_repository";

const REPOSITORY_INPUT = z.object({
  path: z
    .string()
    .optional()
    .describe("The top-level folder of a repository on the workstation, as a full path."),
  url: z
    .string()
    .optional()
    .describe(
      "The Repository URL of a repository on a host instead: https://host/owner/repository, ssh://host/owner/repository or user@host:owner/repository.",
    ),
  folder: z
    .string()
    .optional()
    .describe(
      "A folder inside the repository to read instead of its top level, relative to it, such as apps/server.",
    ),
});

/** Enough to find the base branch among, without a long list filling the session. */
const LISTED_BRANCHES = 30;

/**
 * The Office tools that read the Projects' records (spec §6), and a repository on the workstation
 * before it is one: never one that changes them.
 */
@Injectable()
export class ProjectOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly records: ProjectRecords,
    private readonly localRepositories: LocalRepositories,
    private readonly repositoriesByUrl: RepositoriesByUrl,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.listProjects());
    this.registry.register(this.readRepository());
  }

  listProjects(): OfficeTool {
    return {
      name: LIST_PROJECTS,
      description:
        "Lists the Projects The Office works on, each with the settings its page shows: its path and base branch and where a chat reads it, its commands, how it publishes, its default Pipeline, Project limit and Run environment, its environment (Secret variables by name and whether a value is set, never their values) and its last environment check, its engines, its skills and its Server values.",
      input: z.object({}),
      run: async () => ({ text: await this.records.everyone(), isError: false }),
    };
  }

  readRepository(): OfficeTool<typeof REPOSITORY_INPUT> {
    return {
      name: READ_REPOSITORY,
      description:
        "Reads a git repository that is not a Project yet, to onboard it: one on the workstation by its `path`, or one on a host by its Repository URL as `url`, fetched one commit deep with nothing cloned. It gives the branches (the local ones with the checked-out one marked, or the remote's with its default one marked, whose last commit is read), and the names in the top-level folder, or in `folder` inside it, with the manifest files there (package.json, README and the like), each up to about 2k tokens. Read a folder below with `folder` when the top level points to packages there. It is the only way to read the repository from this chat: Read, Glob, Grep and git are refused outside your folders.",
      input: REPOSITORY_INPUT,
      run: async (given) => {
        try {
          return { text: await this.repositoryText(given), isError: false };
        } catch (error) {
          if (error instanceof ProjectRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    };
  }

  /** A repository on the workstation by its path, or one on a host by its Repository URL. */
  private async repositoryText({
    path,
    url,
    folder,
  }: z.infer<typeof REPOSITORY_INPUT>): Promise<string> {
    if (path !== undefined && url === undefined)
      return localRepositoryText(path, await this.localRepositories.read(path, folder));
    if (url !== undefined && path === undefined)
      return repositoryByUrlText(await this.repositoriesByUrl.read(url, folder));
    throw new ProjectRefused([
      "Give the repository's path on the workstation or its Repository URL, one of the two.",
    ]);
  }
}

function localRepositoryText(path: string, repository: LocalRepository): string {
  return [
    localBranchesText(repository.branches),
    folderText(`The repository at ${path}`, repository),
  ].join("\n\n");
}

function repositoryByUrlText(repository: RepositoryByUrl): string {
  const { url, defaultBranch, commit, branches } = repository;
  return [
    remoteBranchesText(branches, defaultBranch),
    folderText(
      `The repository at ${url}, its default branch ${defaultBranch} at commit ${commit.slice(0, 7)}`,
      repository,
    ),
  ].join("\n\n");
}

function folderText(heading: string, { folder, entries, manifests }: RepositoryFolder): string {
  const listing = entries.map(({ name, kind }) => `- ${name}${kind === "folder" ? "/" : ""}`);
  return [
    `${heading}, ${folder === "" ? "at its top level" : `in ${folder}`}:`,
    listing.length > 0 ? listing.join("\n") : "(empty)",
    ...manifests.map(manifestText),
  ].join("\n\n");
}

/** The checked-out branch first, so a long list never hides it. */
function localBranchesText(branches: readonly LocalBranch[]): string {
  if (branches.length === 0) return "Local branches: none yet.";
  const listed = branches
    .toSorted((first, second) => Number(second.checkedOut) - Number(first.checkedOut))
    .map(({ name, checkedOut }) => (checkedOut ? `${name} (checked out)` : name));
  return `Local branches: ${listedText(listed)}.`;
}

/** The default branch first, as the checked-out one is for a repository on the workstation. */
function remoteBranchesText(branches: readonly string[], defaultBranch: string): string {
  const listed = [
    `${defaultBranch} (the default)`,
    ...branches.filter((name) => name !== defaultBranch),
  ];
  return `Branches on the remote: ${listedText(listed)}.`;
}

function listedText(names: readonly string[]): string {
  const more = names.length - LISTED_BRANCHES;
  return `${names.slice(0, LISTED_BRANCHES).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

function manifestText({ name, text, cut }: ManifestFile): string {
  return `## ${name}${cut ? " (its start; the file goes on)" : ""}\n\n${text}`;
}
