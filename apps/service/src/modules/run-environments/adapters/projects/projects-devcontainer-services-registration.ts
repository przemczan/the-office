import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DevcontainerServices } from "../../../projects/index.js";
import { readDefinitionWith } from "../../application/definition-files.js";
import { RunEnvironmentSettingRefused } from "../../domain/run-environment-setting-refused.js";
import { RepositoryFiles } from "../../ports/repository-files.js";

/**
 * Gives Projects the services of a repository's `.devcontainer/` definition, which a test target's
 * entry point may name; a definition missing or not valid has none.
 */
@Injectable()
export class ProjectsDevcontainerServicesRegistration implements OnModuleInit {
  constructor(
    private readonly registry: DevcontainerServices,
    private readonly files: RepositoryFiles,
  ) {}

  onModuleInit(): void {
    this.registry.register(async (projectId, commit) => {
      try {
        const { reading } = await readDefinitionWith((path) =>
          this.files.textAt(projectId, commit, path),
        );
        return reading.value?.services;
      } catch (error) {
        // A file of the definition too large to read leaves it unreadable, as one not valid.
        if (error instanceof RunEnvironmentSettingRefused) return undefined;
        throw error;
      }
    });
  }
}
