import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import type { Project } from "../domain/project.js";
import { Git } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";

/** A Project's base branch as a chat session reads it. */
export interface BaseCheckout {
  readonly projectId: string;
  readonly name: string;
  readonly baseBranch: string;
  /** Where the base branch is checked out, inside `BaseCheckouts.folder`. */
  readonly folder: string;
}

/**
 * Each Project's base branch, checked out detached under `<office-data>/bases/<project>` for chat
 * sessions, which read every Project and change none (spec §2.4, §6). A chat session works in the
 * folder that holds them all, so its read fence covers each.
 */
@Injectable()
export class BaseCheckouts {
  private readonly logger = new Logger(BaseCheckouts.name);
  private readonly operatingSystem = currentOperatingSystem();

  constructor(
    private readonly projects: ProjectRepository,
    private readonly git: Git,
    private readonly worktrees: Worktrees,
    private readonly commands: ProjectCommandRunner,
    private readonly officeData: OfficeDataDirectory,
  ) {}

  /** The folder a chat session works in. */
  get folder(): string {
    return this.officeData.folder("bases");
  }

  /** Every Project with where its base branch is checked out, without running git. */
  async list(): Promise<readonly BaseCheckout[]> {
    return (await this.projects.list()).map((project) => this.checkoutOf(project));
  }

  /**
   * Checks each Project's base branch out afresh, from its upstream fetched first, as a Task's
   * worktree starts (spec §9). A Project that fails keeps the checkout it had, and is left out
   * when it has none. The folder that holds them is made even with no Project, since a chat
   * session works in it, as Devops does onboarding the first Project.
   */
  async refresh(): Promise<readonly BaseCheckout[]> {
    await mkdir(this.folder, { recursive: true });
    const refreshed: BaseCheckout[] = [];
    for (const project of await this.projects.list()) {
      const checkout = this.checkoutOf(project);
      try {
        await this.checkOut(project, checkout.folder);
      } catch (error) {
        this.logger.warn(
          `${project.name}'s base branch wasn't checked out afresh at ${checkout.folder}: ${String(error)}`,
        );
      }
      if (await exists(checkout.folder)) refreshed.push(checkout);
    }
    return refreshed;
  }

  private checkoutOf(project: Project): BaseCheckout {
    return {
      projectId: project.id,
      name: project.name,
      baseBranch: project.baseBranch,
      folder: join(this.folder, project.id),
    };
  }

  private async checkOut(project: Project, folder: string): Promise<void> {
    const variables = this.commands.variablesFor(project.environment);
    const { commit } = await this.worktrees.freshBase(project, variables);
    if (await exists(folder)) {
      await this.git.checkoutDetached(folder, commit, variables);
      return;
    }
    const tooLong = this.operatingSystem.paths.lengthProblem(folder, "directory");
    if (tooLong) throw new Error(tooLong);
    await mkdir(this.folder, { recursive: true });
    await this.git.addWorktree(
      project.path,
      { path: folder, checkout: { kind: "detached", startPoint: commit } },
      variables,
    );
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}
