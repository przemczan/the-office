import { Injectable } from "@nestjs/common";
import { ProjectRefused, ProjectService, type SettingChangedBy } from "../../../projects/index.js";
import { RunEnvironmentSettingRefused } from "../../domain/run-environment-setting-refused.js";
import {
  ProjectSettings,
  type ProjectSetting,
  type RunEnvironmentSetting,
} from "../../ports/project-settings.js";

/** The setting on Projects' own record, its refusals in this module's words. */
@Injectable()
export class ProjectsSettings extends ProjectSettings {
  constructor(private readonly projects: ProjectService) {
    super();
  }

  async settingOf(projectId: string): Promise<ProjectSetting | undefined> {
    const project = await this.projects.find(projectId);
    return (
      project && {
        runEnvironment: project.runEnvironment,
        setUpProblems: project.runEnvironmentSetUpProblems,
      }
    );
  }

  async change(
    projectId: string,
    runEnvironment: RunEnvironmentSetting,
    by: SettingChangedBy,
  ): Promise<void> {
    await refusedInOurWords(() =>
      this.projects.changeRunEnvironment(projectId, runEnvironment, by),
    );
  }

  async finishSetUp(projectId: string, definitionProblems: readonly string[]): Promise<void> {
    await this.projects.finishRunEnvironmentSetUp(projectId, definitionProblems);
  }
}

/** Runs `work`, a Projects refusal answered as this module's. */
export async function refusedInOurWords<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ProjectRefused) throw new RunEnvironmentSettingRefused(error.reasons);
    throw error;
  }
}
