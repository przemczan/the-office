import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { RunEnvironmentSetUpRegistry } from "../../../projects/index.js";
import { ProjectRunEnvironments } from "../../application/project-run-environments.js";

/** Gives Projects Set up run environment, for a Project added with the answer Yes. */
@Injectable()
export class ProjectsSetUpRegistration implements OnModuleInit {
  private readonly logger = new Logger(ProjectsSetUpRegistration.name);

  constructor(
    private readonly registry: RunEnvironmentSetUpRegistry,
    private readonly projectRunEnvironments: ProjectRunEnvironments,
  ) {}

  onModuleInit(): void {
    this.registry.register(async (projectId, by) => {
      const { start } = await this.projectRunEnvironments.setUp(projectId, by);
      if (start?.outcome === "refused") {
        this.logger.warn(
          `The Project ${projectId}'s set-up Task didn't start: ${start.reasons.join(" ")}`,
        );
      }
    });
  }
}
