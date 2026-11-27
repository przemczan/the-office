import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  ProjectNotFound,
  ProjectRefused,
  RunEnvironmentSetUpRegistry,
} from "../../../projects/index.js";
import { toOffBoardTaskStartResponse } from "../../../work/index.js";
import { ProjectRunEnvironments } from "../../application/project-run-environments.js";
import {
  RunEnvironmentProjectNotFound,
  RunEnvironmentSettingRefused,
} from "../../domain/run-environment-setting-refused.js";
import { toProjectRunEnvironmentResponse } from "../http/project-run-environment-response.js";

/**
 * Gives Projects Set up run environment, for a Project added with the answer Yes and for the
 * Office action set_up_run_environment, its refusals in Projects' words.
 */
@Injectable()
export class ProjectsSetUpRegistration implements OnModuleInit {
  private readonly logger = new Logger(ProjectsSetUpRegistration.name);

  constructor(
    private readonly registry: RunEnvironmentSetUpRegistry,
    private readonly projectRunEnvironments: ProjectRunEnvironments,
  ) {}

  onModuleInit(): void {
    this.registry.register(async (projectId, by) => {
      try {
        const { runEnvironment, start } = await this.projectRunEnvironments.setUp(projectId, by);
        if (start?.outcome === "refused") {
          this.logger.warn(
            `The Project ${projectId}'s set-up Task didn't start: ${start.reasons.join(" ")}`,
          );
        }
        return {
          runEnvironment: toProjectRunEnvironmentResponse(runEnvironment),
          start: start ? toOffBoardTaskStartResponse(start) : null,
        };
      } catch (error) {
        if (error instanceof RunEnvironmentSettingRefused) throw new ProjectRefused(error.reasons);
        if (error instanceof RunEnvironmentProjectNotFound) {
          throw new ProjectNotFound(error.projectId);
        }
        throw error;
      }
    });
  }
}
