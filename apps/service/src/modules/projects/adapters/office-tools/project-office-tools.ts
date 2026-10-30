import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
import { BaseCheckouts } from "../../application/base-checkouts.js";
import {
  LocalRepositories,
  type LocalRepository,
  type ManifestFile,
} from "../../application/local-repositories.js";
import { ProjectService } from "../../application/project-service.js";
import type { Project } from "../../domain/project.js";
import { ProjectRefused } from "../../domain/project-refused.js";

export const LIST_PROJECTS = "list_projects";
export const READ_LOCAL_REPOSITORY = "read_local_repository";

const LOCAL_REPOSITORY_INPUT = z.object({
  path: z.string().describe("The repository's top-level folder, as a full path."),
});

/**
 * The Office tools that read the Projects' records (spec §6), and a repository on the workstation
 * before it is one: never one that changes them.
 */
@Injectable()
export class ProjectOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly projects: ProjectService,
    private readonly bases: BaseCheckouts,
    private readonly localRepositories: LocalRepositories,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.listProjects());
    this.registry.register(this.readLocalRepository());
  }

  listProjects(): OfficeTool {
    return {
      name: LIST_PROJECTS,
      description:
        "Lists the Projects The Office works on: each one's base branch and where a chat reads it, its commands, how it publishes and its default Pipeline.",
      input: z.object({}),
      run: async () => {
        const projects = await this.projects.list();
        if (projects.length === 0)
          return { text: "The Office works on no Project yet.", isError: false };
        const checkouts = new Map(
          (await this.bases.list()).map((checkout) => [checkout.projectId, checkout.folder]),
        );
        const text = projects
          .map((project) => projectRecord(project, checkouts.get(project.id)))
          .join("\n\n");
        return { text, isError: false };
      },
    };
  }

  readLocalRepository(): OfficeTool<typeof LOCAL_REPOSITORY_INPUT> {
    return {
      name: READ_LOCAL_REPOSITORY,
      description:
        "Reads a git repository on the workstation that is not a Project yet, to onboard it: the names at its top level and its manifest files there (package.json, README and the like), each up to about 2k tokens. It reads nothing below the top level.",
      input: LOCAL_REPOSITORY_INPUT,
      run: async ({ path }) => {
        try {
          const repository = await this.localRepositories.read(path);
          return { text: localRepositoryText(path, repository), isError: false };
        } catch (error) {
          if (error instanceof ProjectRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    };
  }
}

function localRepositoryText(path: string, { entries, manifests }: LocalRepository): string {
  const listing = entries.map(({ name, kind }) => `- ${name}${kind === "folder" ? "/" : ""}`);
  return [
    `The repository at ${path}, at its top level:`,
    listing.length > 0 ? listing.join("\n") : "(empty)",
    ...manifests.map(manifestText),
  ].join("\n\n");
}

function manifestText({ name, text, cut }: ManifestFile): string {
  return `## ${name}${cut ? " (its start; the file goes on)" : ""}\n\n${text}`;
}

function projectRecord(project: Project, checkout: string | undefined): string {
  const { install, build, lint, test } = project.commands;
  return [
    `${project.name} (id ${project.id})`,
    `- Base branch: ${project.baseBranch}${checkout ? `, read-only in chats at ${checkout}` : ""}`,
    `- Commands: install \`${install || "none"}\`, build \`${build || "none"}\`, lint \`${lint || "none"}\`, test \`${test || "none"}\``,
    `- Install inputs: ${project.installInputs.length > 0 ? project.installInputs.join(", ") : "none"}`,
    `- Publishing: ${project.publishingMode === "merge" ? `merge into ${project.baseBranch}` : "push and open a pull request"}`,
    `- Default Pipeline: ${project.defaultPipeline}`,
  ].join("\n");
}
