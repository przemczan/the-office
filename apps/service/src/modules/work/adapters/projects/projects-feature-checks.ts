import { Injectable } from "@nestjs/common";
import { ProjectFeatures, ProjectNotFound, ProjectRefused } from "../../../projects/index.js";
import { TaskRefused } from "../../domain/task-refused.js";
import {
  ProjectFeatureChecks,
  type WorkProjectFeature,
} from "../../ports/project-feature-checks.js";

/** Projects' feature switches; its refusals come out as Work's, in the same words. */
@Injectable()
export class ProjectsFeatureChecks extends ProjectFeatureChecks {
  constructor(private readonly features: ProjectFeatures) {
    super();
  }

  async ensureOn(projectId: string, feature: WorkProjectFeature): Promise<void> {
    try {
      await this.features.ensureOn(projectId, feature);
    } catch (error) {
      if (error instanceof ProjectRefused) throw new TaskRefused([...error.reasons]);
      if (error instanceof ProjectNotFound) {
        throw new TaskRefused([`There is no Project "${projectId}".`]);
      }
      throw error;
    }
  }
}
