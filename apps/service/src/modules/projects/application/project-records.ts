import { Injectable } from "@nestjs/common";
import type { Project } from "../domain/project.js";
import { BaseCheckouts } from "./base-checkouts.js";
import { ProjectService } from "./project-service.js";

/**
 * The Projects' short records as an Agent reads them: `list_projects` gives them all, and a chat
 * message sent beside a Project's page gives its own (spec §2.4).
 */
@Injectable()
export class ProjectRecords {
  constructor(
    private readonly projects: ProjectService,
    private readonly bases: BaseCheckouts,
  ) {}

  /** Every Project's record, or that there is none. */
  async everyone(): Promise<string> {
    const projects = await this.projects.list();
    if (projects.length === 0) return "The Office works on no Project yet.";
    const checkouts = await this.checkoutFolders();
    return projects
      .map((project) => projectRecord(project, checkouts.get(project.id)))
      .join("\n\n");
  }

  /** The Project's record; undefined when The Office has no such Project. */
  async of(projectId: string): Promise<string | undefined> {
    const project = await this.projects.find(projectId);
    if (!project) return undefined;
    return projectRecord(project, (await this.checkoutFolders()).get(project.id));
  }

  private async checkoutFolders(): Promise<ReadonlyMap<string, string>> {
    return new Map(
      (await this.bases.list()).map((checkout) => [checkout.projectId, checkout.folder]),
    );
  }
}

function projectRecord(project: Project, checkout: string | undefined): string {
  const commands = project.commands.map(
    ({ key, name, kind, commandLine }) => `${key} (${name}, ${kind}) \`${commandLine || "none"}\``,
  );
  return [
    `${project.name} (id ${project.id})`,
    `- Base branch: ${project.baseBranch}${checkout ? `, read-only in chats at ${checkout}` : ""}`,
    `- Install: \`${project.installCommand || "none"}\``,
    `- Commands: ${commands.length > 0 ? commands.join(", ") : "none"}`,
    `- Install inputs: ${project.installInputs.length > 0 ? project.installInputs.join(", ") : "none"}`,
    `- Publishing: ${project.publishingMode === "merge" ? `merge into ${project.baseBranch}` : "push and open a pull request"}`,
    `- Before publishing: \`${project.beforePublishingCommand || "none"}\``,
    `- After publishing: \`${project.afterPublishingCommand || "none"}\``,
    `- Default Pipeline: ${project.defaultPipeline}`,
  ].join("\n");
}
