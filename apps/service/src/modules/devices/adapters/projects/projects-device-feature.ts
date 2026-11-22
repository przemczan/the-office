import { Injectable } from "@nestjs/common";
import { FeatureSwitchedOff, ProjectFeatures } from "../../../projects/index.js";
import { ProjectDeviceFeature } from "../../ports/project-features.js";

/** The Project's Connected devices switch, as Projects reads it, in Projects' words. */
@Injectable()
export class ProjectsDeviceFeature extends ProjectDeviceFeature {
  constructor(private readonly features: ProjectFeatures) {
    super();
  }

  async switchedOffReasonOf(projectId: string): Promise<string | undefined> {
    try {
      await this.features.ensureOn(projectId, "connected-devices");
      return undefined;
    } catch (error) {
      if (error instanceof FeatureSwitchedOff) return error.reasons.join(" ");
      throw error;
    }
  }
}
