import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";
import type { Project } from "../domain/project.js";
import { Git, type GitVariables } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";

/**
 * A chat session's first answer waits for the refresh, so Projects refresh side by side, a few at
 * a time so a long list doesn't start all its git processes at once.
 */
const REFRESHED_AT_ONCE = 8;

/**
 * A Project as a chat session, or one on an Initiative, reads it: its base branch, or the
 * Initiative's branch in a Project the Initiative spans.
 */
export interface BaseCheckout {
  readonly projectId: string;
  readonly name: string;
  readonly baseBranch: string;
  /**
   * Where it is checked out: inside `BaseCheckouts.folder`, or inside `initiativeFolder` when it
   * reads the Initiative's branch.
   */
  readonly folder: string;
  /**
   * The Initiative's branch the session would read in this Project, on an Initiative only;
   * `gone` once it was deleted here, so the base branch is read instead.
   */
  readonly initiativeBranch?: { readonly branch: string; readonly gone: boolean };
}

/** Which Projects a session on an Initiative reads at its Initiative's branch. */
export interface InitiativeBranchReads {
  /** The Initiative's Short name, which names its checkouts' folder. */
  readonly shortName: string;
  /** `initiative/<short name>`. */
  readonly branch: string;
  /** The Projects it spans that have its branch. */
  readonly projectIds: readonly string[];
}

/**
 * Each Project's base branch, checked out detached under `<office-data>/bases/<project>` for chat
 * sessions, which read every Project and change none (spec §2.4, §6). A chat session works in the
 * folder that holds them all, so its read fence covers each. A session on an Initiative with a
 * Pipeline reads the Initiative's branch instead in the Projects it spans, checked out detached
 * under `<office-data>/initiative-bases/<short name>/<project>` from its local ref, which every
 * Publish into it moves before pushing, so nothing is fetched (spec §5.5).
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

  /** The folder holding an Initiative's branch checkouts, one per Project. */
  initiativeFolder(shortName: string): string {
    return join(this.officeData.folder("initiative-bases"), shortName);
  }

  /**
   * Every Project with where a session on the Initiative reads it: the Initiative's branch in each
   * Project of `reads` that has it, else the base branch. Asks git only whether each branch is
   * there, fetching nothing, since a Brief is read before the checkouts refresh.
   */
  async listOnInitiative(reads: InitiativeBranchReads): Promise<readonly BaseCheckout[]> {
    const projects = await this.projects.list();
    return Promise.all(projects.map((project) => this.listedOnInitiative(project, reads)));
  }

  /**
   * As `refresh`, then checks the Initiative's branch out afresh in each Project of `reads`, at the
   * commit its local ref names. A Project that fails keeps the checkout it had, or is read at its
   * base when it has none; one whose branch is gone loses its checkout and is read at its base.
   */
  async refreshOnInitiative(reads: InitiativeBranchReads): Promise<readonly BaseCheckout[]> {
    const bases = await this.refresh();
    const projects = await this.projects.list();
    const refreshed: BaseCheckout[] = [];
    for (let start = 0; start < projects.length; start += REFRESHED_AT_ONCE) {
      const batch = projects.slice(start, start + REFRESHED_AT_ONCE);
      const checkouts = await Promise.all(
        batch.map((project) => {
          const base = bases.find(({ projectId }) => projectId === project.id);
          return reads.projectIds.includes(project.id)
            ? this.refreshedOnInitiative(project, reads, base)
            : base;
        }),
      );
      refreshed.push(...checkouts.filter((checkout) => checkout !== undefined));
    }
    return refreshed;
  }

  /**
   * Checks each Project's base branch out afresh, from its upstream fetched first, as a Task's
   * worktree starts (spec §9). A Project that fails keeps the checkout it had, and is left out
   * when it has none. The folder that holds them is made even with no Project, since a chat
   * session works in it, as Devops does onboarding the first Project.
   */
  async refresh(): Promise<readonly BaseCheckout[]> {
    await mkdir(this.folder, { recursive: true });
    const projects = await this.projects.list();
    const refreshed: BaseCheckout[] = [];
    for (let start = 0; start < projects.length; start += REFRESHED_AT_ONCE) {
      const batch = projects.slice(start, start + REFRESHED_AT_ONCE);
      const checkouts = await Promise.all(batch.map((project) => this.refreshed(project)));
      refreshed.push(...checkouts.filter((checkout) => checkout !== undefined));
    }
    return refreshed;
  }

  private async refreshed(project: Project): Promise<BaseCheckout | undefined> {
    const checkout = this.checkoutOf(project);
    try {
      await this.checkOut(project, checkout.folder);
    } catch (error) {
      this.logger.warn(
        `${project.name}'s base branch wasn't checked out afresh at ${checkout.folder}: ${String(error)}`,
      );
    }
    return (await exists(checkout.folder)) ? checkout : undefined;
  }

  private async listedOnInitiative(
    project: Project,
    reads: InitiativeBranchReads,
  ): Promise<BaseCheckout> {
    const base = this.checkoutOf(project);
    if (!reads.projectIds.includes(project.id)) return base;
    let there: boolean;
    try {
      there = await this.git.hasBranch(project.path, reads.branch);
    } catch (error) {
      this.logger.warn(
        `${project.name}'s branch ${reads.branch} couldn't be looked up: ${String(error)}`,
      );
      return base;
    }
    return there
      ? this.initiativeCheckoutOf(project, reads)
      : { ...base, initiativeBranch: { branch: reads.branch, gone: true } };
  }

  private async refreshedOnInitiative(
    project: Project,
    reads: InitiativeBranchReads,
    base: BaseCheckout | undefined,
  ): Promise<BaseCheckout | undefined> {
    const checkout = this.initiativeCheckoutOf(project, reads);
    const variables = this.commands.variablesFor(project.environment);
    try {
      const commit = await this.git.findCommit(project.path, `refs/heads/${reads.branch}`);
      if (commit === undefined) {
        return await this.withoutBranch(
          project,
          { branch: reads.branch, folder: checkout.folder },
          base,
          variables,
        );
      }
      await this.checkOutAt(project, checkout.folder, commit, variables);
    } catch (error) {
      this.logger.warn(
        `${project.name}'s branch ${reads.branch} wasn't checked out afresh at ${checkout.folder}: ${String(error)}`,
      );
    }
    return (await exists(checkout.folder)) ? checkout : base;
  }

  /** The Initiative's branch is gone in the Project: its checkout goes, and the base is read. */
  private async withoutBranch(
    project: Project,
    { branch, folder }: { readonly branch: string; readonly folder: string },
    base: BaseCheckout | undefined,
    variables: GitVariables,
  ): Promise<BaseCheckout | undefined> {
    if (await exists(folder)) {
      try {
        await this.git.removeWorktree(project.path, folder, variables);
      } catch (error) {
        this.logger.warn(
          `${project.name}'s checkout of the gone branch ${branch} wasn't removed from ${folder}: ${String(error)}`,
        );
      }
    }
    return base && { ...base, initiativeBranch: { branch, gone: true } };
  }

  private initiativeCheckoutOf(project: Project, reads: InitiativeBranchReads): BaseCheckout {
    return {
      ...this.checkoutOf(project),
      folder: join(this.initiativeFolder(reads.shortName), project.id),
      initiativeBranch: { branch: reads.branch, gone: false },
    };
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
    await this.checkOutAt(project, folder, commit, variables);
  }

  /** Moves the folder's detached checkout to `commit`, or adds it there when it has none. */
  private async checkOutAt(
    project: Project,
    folder: string,
    commit: string,
    variables: GitVariables,
  ): Promise<void> {
    if (await exists(folder)) {
      await this.git.checkoutDetached(folder, commit, variables);
      return;
    }
    const tooLong = this.operatingSystem.paths.lengthProblem(folder, "directory");
    if (tooLong) throw new Error(tooLong);
    await mkdir(dirname(folder), { recursive: true });
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
