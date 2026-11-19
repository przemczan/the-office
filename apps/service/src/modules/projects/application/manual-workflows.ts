import { Injectable, Logger } from "@nestjs/common";
import type { ManualWorkflow } from "../domain/manual-workflow.js";
import type { Project } from "../domain/project.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { CodeHostRefused, type CodeHost } from "../ports/code-host.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { CiRunWatch } from "./ci-run-watch.js";

/** The Workflows a Project can start by hand on a ref, and why none could be listed. */
export interface ManualWorkflowList {
  readonly ref: string;
  readonly workflows: readonly ManualWorkflow[];
  /** In plain words; null when they were listed. */
  readonly problem: string | null;
}

/** A Project's branches and tags on its code host, and why they couldn't be listed. */
export interface RefList {
  readonly branches: readonly string[];
  readonly tags: readonly string[];
  readonly baseBranch: string;
  /** In plain words; null when they were listed. */
  readonly problem: string | null;
}

/** What the code host answered, or why it couldn't be asked or refused, in plain words. */
type Read<Answer> = { readonly answer: Answer } | { readonly problem: string };

/**
 * Reads what starting a Workflow by hand offers, from the code host that holds the Project's base
 * branch remote: the Workflows that declare a start by hand on a ref, and the branches and tags.
 * Never fails for the host: nobody signed in, a refusal or a failure answers nothing with the
 * problem in plain words. Throws ProjectNotFound for a Project that isn't there.
 */
@Injectable()
export class ManualWorkflows {
  private readonly logger = new Logger(ManualWorkflows.name);

  constructor(
    private readonly projects: ProjectRepository,
    private readonly ciRuns: CiRunWatch,
  ) {}

  /** The Workflows that can be started by hand on `ref`, the Project's base branch when left out. */
  async list(projectId: string, ref?: string): Promise<ManualWorkflowList> {
    const project = await this.found(projectId);
    const at = ref ?? project.baseBranch;
    const read = await this.reading(project, (host, remoteUrl) =>
      host.manualWorkflows(remoteUrl, at),
    );
    return "answer" in read
      ? { ref: at, workflows: read.answer, problem: null }
      : { ref: at, workflows: [], problem: read.problem };
  }

  /** The repository's branches and tags, with the Project's base branch. */
  async refs(projectId: string): Promise<RefList> {
    const project = await this.found(projectId);
    const read = await this.reading(project, (host, remoteUrl) => host.refs(remoteUrl));
    return "answer" in read
      ? { ...read.answer, baseBranch: project.baseBranch, problem: null }
      : { branches: [], tags: [], baseBranch: project.baseBranch, problem: read.problem };
  }

  private async found(projectId: string): Promise<Project> {
    const project = await this.projects.find(projectId);
    if (project === undefined) throw new ProjectNotFound(projectId);
    return project;
  }

  /** Asks the Project's code host, unless it can't be read now; its refusal is the problem. */
  private async reading<Answer>(
    project: Project,
    ask: (host: CodeHost, remoteUrl: string) => Promise<Answer>,
  ): Promise<Read<Answer>> {
    const onHost = await this.ciRuns.onHost(project);
    if (onHost === undefined) {
      return {
        problem: `"${project.name}" has no Workflows to start: its base branch tracks no remote on a code host The Office knows.`,
      };
    }
    const { remoteUrl, host } = onHost;
    const why = await host.whyCannotRead(remoteUrl);
    if (why !== undefined) return { problem: why };
    try {
      return { answer: await ask(host, remoteUrl) };
    } catch (error) {
      if (error instanceof CodeHostRefused) return { problem: error.message };
      this.logger.warn(
        `${host.name} failed reading the Workflows of ${project.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { problem: `${host.name} couldn't be reached. Try again in a moment.` };
    }
  }
}
