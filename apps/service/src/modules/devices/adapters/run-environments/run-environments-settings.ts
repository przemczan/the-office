import { Injectable } from "@nestjs/common";
import { ProjectRunEnvironments } from "../../../run-environments/index.js";
import { ProjectRunEnvironmentSettings } from "../../ports/project-run-environment-settings.js";

/** The Project's Run environment setting, as Run environments reads it. */
@Injectable()
export class RunEnvironmentsSettings extends ProjectRunEnvironmentSettings {
  constructor(private readonly projectRunEnvironments: ProjectRunEnvironments) {
    super();
  }

  isOn(projectId: string): Promise<boolean> {
    return this.projectRunEnvironments.isOn(projectId);
  }
}
