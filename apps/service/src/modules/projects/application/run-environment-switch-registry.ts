import { Injectable } from "@nestjs/common";
import type { RunEnvironmentSetting } from "../domain/project.js";
import type { SettingChangedBy } from "../domain/project-setting-change.js";

/**
 * Turns a Project's Run environment On or Off as the Project page does, either way at any time; a
 * Project there is none of, as a ProjectNotFound.
 */
export type RunEnvironmentSwitch = (
  projectId: string,
  runEnvironment: RunEnvironmentSetting,
  by: SettingChangedBy,
) => Promise<void>;

/**
 * The Run environment switch, given by Run environments as it starts, for a person's change on a
 * Task (Conversations' Office tools): Run environments reads the definition and the setting through
 * Projects, and Conversations can't import it (the module template's registry).
 */
@Injectable()
export class RunEnvironmentSwitchRegistry {
  private registered: RunEnvironmentSwitch | undefined;

  register(change: RunEnvironmentSwitch): void {
    this.registered = change;
  }

  async change(
    projectId: string,
    runEnvironment: RunEnvironmentSetting,
    by: SettingChangedBy,
  ): Promise<void> {
    if (!this.registered) throw new Error("No Run environment switch is registered.");
    await this.registered(projectId, runEnvironment, by);
  }
}
