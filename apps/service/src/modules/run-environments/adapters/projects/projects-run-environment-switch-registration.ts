import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ProjectNotFound,
  ProjectRefused,
  RunEnvironmentSwitchRegistry,
} from "../../../projects/index.js";
import { ProjectRunEnvironments } from "../../application/project-run-environments.js";
import {
  RunEnvironmentProjectNotFound,
  RunEnvironmentSettingRefused,
} from "../../domain/run-environment-setting-refused.js";

/**
 * Gives Projects the Run environment switch the Project page uses, for a person's change on a
 * Task, its refusals in Projects' words.
 */
@Injectable()
export class ProjectsRunEnvironmentSwitchRegistration implements OnModuleInit {
  constructor(
    private readonly registry: RunEnvironmentSwitchRegistry,
    private readonly projectRunEnvironments: ProjectRunEnvironments,
  ) {}

  onModuleInit(): void {
    this.registry.register(async (projectId, runEnvironment, by) => {
      try {
        await this.projectRunEnvironments.change(projectId, runEnvironment, by);
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
