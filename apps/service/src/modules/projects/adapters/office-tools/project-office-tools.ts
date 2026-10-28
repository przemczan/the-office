import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { BaseCheckouts } from "../../application/base-checkouts.js";
import { ProjectService } from "../../application/project-service.js";
import type { Project } from "../../domain/project.js";

/** An Office tool as the registry takes it. */
type OfficeTool = Parameters<OfficeToolRegistry["register"]>[0];

export const LIST_PROJECTS = "list_projects";

/** The Office tools that read the Projects' records (spec §6): never one that changes them. */
@Injectable()
export class ProjectOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly projects: ProjectService,
    private readonly bases: BaseCheckouts,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.listProjects());
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
