import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  PROJECT_OFFICE_ACTIONS,
  RERUN_CI_RUN_ACTION,
  type OfficeAction,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { CiRunWatch } from "../../application/ci-run-watch.js";
import { ensureRerunnable, type CiRunJobs } from "../../domain/ci-run.js";
import type { Project } from "../../domain/project.js";
import { ProjectNotFound } from "../../domain/project-not-found.js";
import { ProjectRefused } from "../../domain/project-refused.js";
import { CodeHostRefused, type CiRunOnHost } from "../../ports/code-host.js";
import { ProjectRepository } from "../../ports/project-repository.js";

/**
 * One of Projects' Office actions as Projects carries it out: `handle` for the user's request and
 * the Agent's call alike, its result answered to the web by `response` and worded to the Agent by
 * `words`. No action of Projects records who asked, so none takes them.
 */
interface ProjectActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>): Promise<Result>;
  response(result: Result): z.input<Action["answer"]>;
  words(result: Result): string;
}

/** A handler with its action's types left behind, as the routes and tools look it up by name. */
type AnyProjectActionHandler = ProjectActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: ProjectActionHandler<Action, Result>,
): AnyProjectActionHandler {
  return each as unknown as AnyProjectActionHandler;
}

/** A CI run that runs again, as the re-run answers it. */
interface Rerun {
  readonly project: Project;
  readonly run: CiRunOnHost;
  readonly jobs: CiRunJobs;
}

/**
 * Projects' Office actions (the Office action convention): the one handler of each action Projects
 * declares, which its route (`ProjectOfficeActionsController`) and its Office tool, registered
 * here, both call. Throws at start for a declared action with no handler.
 */
@Injectable()
export class ProjectOfficeActions implements OnModuleInit {
  private readonly logger = new Logger(ProjectOfficeActions.name);
  private readonly handlers: ReadonlyMap<string, AnyProjectActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly projects: ProjectRepository,
    private readonly ciRuns: CiRunWatch,
  ) {
    this.handlers = new Map([this.rerunCiRun()].map((each) => [each.action.name, each]));
    const unhandled = PROJECT_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      this.registry.register(
        officeActionTool(each.action, (input) =>
          answered(async () => each.words(await each.handle(input))),
        ),
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Projects carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never));
  }

  private rerunCiRun(): AnyProjectActionHandler {
    return handler({
      action: RERUN_CI_RUN_ACTION,
      handle: ({ projectId, runId, jobs }) => this.rerun(projectId, runId, jobs),
      response: ({ project, run, jobs }: Rerun) => ({ projectId: project.id, runId: run.id, jobs }),
      words: ({ project, run, jobs }) =>
        `CI run ${run.workflow} #${run.number} of "${project.name}" runs again, ${jobs === "all" ? "all its jobs" : "only its failed jobs"}.`,
    });
  }

  /**
   * Re-runs a failed or cancelled run on the Project's code host, then lists its runs again at
   * once, so Work › CI shows it queued.
   */
  private async rerun(projectId: string, runId: number, jobs: CiRunJobs): Promise<Rerun> {
    const project = await this.projects.find(projectId);
    if (project === undefined) throw new ProjectNotFound(projectId);
    const onHost = await this.ciRuns.onHost(project);
    if (onHost === undefined) {
      throw new ProjectRefused([
        `"${project.name}" has no CI runs to re-run: its base branch tracks no remote on a code host The Office knows.`,
      ]);
    }
    const { remoteUrl, host } = onHost;
    try {
      const run =
        this.ciRuns.runOf(project.id, runId) ??
        (await host.recentRuns(remoteUrl, 100)).find((each) => each.id === runId);
      if (run === undefined) {
        throw new ProjectRefused([
          `"${project.name}" has no CI run ${runId} among its recent runs on ${host.name}.`,
        ]);
      }
      ensureRerunnable(run);
      await host.rerun(remoteUrl, run.id, jobs);
      // Its listing failing fails no re-run: the run runs again all the same, and the next round lists it.
      await this.ciRuns.refresh(project.id, { force: true }).catch((error: unknown) => {
        this.logger.warn(
          `Listing the CI runs of ${project.name} after a re-run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return { project, run, jobs };
    } catch (error) {
      if (error instanceof CodeHostRefused) throw new ProjectRefused([error.message]);
      throw error;
    }
  }
}

/** Projects' refusals answer the Agent in words it can act on; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (error instanceof ProjectRefused || error instanceof ProjectNotFound) {
      return { text: error.message, isError: true };
    }
    throw error;
  }
}
