import type { ProjectSettingChange } from "../domain/project-setting-change.js";

/**
 * Where the changes to each Project's everyday settings are recorded. Only the repositories that
 * save a setting write it, in the transaction of the change; this port reads it.
 */
export abstract class ProjectSettingChangeRepository {
  /** The Project's `limit` newest changes, newest first; none for no such Project. */
  abstract latestOf(projectId: string, limit: number): Promise<readonly ProjectSettingChange[]>;
}
