import { Injectable, type OnModuleInit } from "@nestjs/common";
import { RunEnvironmentSetUpRegistry } from "../../../projects/index.js";
import { ProjectRunEnvironments } from "../../application/project-run-environments.js";

/** Gives Projects Set up run environment, for a Project added with the answer Yes. */
@Injectable()
export class ProjectsSetUpRegistration implements OnModuleInit {
  constructor(
    private readonly registry: RunEnvironmentSetUpRegistry,
    private readonly projectRunEnvironments: ProjectRunEnvironments,
  ) {}

  onModuleInit(): void {
    this.registry.register(async (projectId) => {
      await this.projectRunEnvironments.setUp(projectId);
    });
  }
}
