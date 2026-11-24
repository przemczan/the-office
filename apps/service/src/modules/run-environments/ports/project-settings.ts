import type { SettingChangedBy } from "../../projects/index.js";

/** As Projects keeps it: On runs a Task's checks in its run environment, Off on the host. */
export type RunEnvironmentSetting = "on" | "off";

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

  /** On or Off at any time, nothing checked. Projects records the change as made `by`. */
  abstract change(
    projectId: string,
    runEnvironment: RunEnvironmentSetting,
    by: SettingChangedBy,
  ): Promise<void>;

  /** A set-up Task is Done: On with no problems, else the setting stays and they say why. */
  abstract finishSetUp(projectId: string, definitionProblems: readonly string[]): Promise<void>;
}
