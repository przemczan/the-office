import type { SettingChangedBy } from "../../projects/index.js";

/** As Projects keeps it: "not-decided" until the user picks On or Off. */
export type RunEnvironmentSetting = "not-decided" | "on" | "off";

/** A Project's Run environment setting, and why a set-up Task's Done left it as it was. */
export interface ProjectSetting {
  readonly runEnvironment: RunEnvironmentSetting;
  readonly setUpProblems: readonly string[];
}

/**
 * The Run environment setting on each Project, which Projects keeps; refusals come as
 * `RunEnvironmentSettingRefused`.
 */
export abstract class ProjectSettings {
  /** Undefined when there is no such Project. */
  abstract settingOf(projectId: string): Promise<ProjectSetting | undefined>;

  /**
   * On is refused with `definitionProblems`, the problems of the definition on the base branch.
   * Projects records the change as made `by`.
   */
  abstract change(
    projectId: string,
    runEnvironment: Exclude<RunEnvironmentSetting, "not-decided">,
    definitionProblems: readonly string[],
    by: SettingChangedBy,
  ): Promise<void>;

  /** A set-up Task is Done: On with no problems, else the setting stays and they say why. */
  abstract finishSetUp(projectId: string, definitionProblems: readonly string[]): Promise<void>;
}
