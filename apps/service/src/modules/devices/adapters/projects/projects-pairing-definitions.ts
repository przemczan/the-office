import { Injectable } from "@nestjs/common";
import {
  PairingDefinitionExports,
  ProjectNotFound,
  ProjectRefused,
} from "../../../projects/index.js";
import { PairingDefinitions, type PairingDefinition } from "../../ports/pairing-definitions.js";

/** Projects writes out the base branch tip's `.devcontainer/`, as it knows the repository. */
@Injectable()
export class ProjectsPairingDefinitions extends PairingDefinitions {
  constructor(private readonly exports: PairingDefinitionExports) {
    super();
  }

  async exportDefinition(
    projectId: string,
  ): Promise<PairingDefinition | { readonly problems: readonly string[] }> {
    try {
      return await this.exports.exportDefinition(projectId);
    } catch (error) {
      if (error instanceof ProjectRefused) return { problems: error.reasons };
      if (error instanceof ProjectNotFound) return { problems: [error.message] };
      throw error;
    }
  }
}
