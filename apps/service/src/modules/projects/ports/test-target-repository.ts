import type { TestTarget } from "../domain/test-target.js";
import type { SettingChangeRecording } from "../domain/setting-change-summaries.js";

/** Where each Project's test targets are kept, in the order added (spec §2.12). */
export abstract class TestTargetRepository {
  /** The Project's test targets; none for a Project with none, or no such Project. */
  abstract listOf(projectId: string): Promise<readonly TestTarget[]>;

  /**
   * Replaces the Project's test targets, whole, with what `change` makes of them as stored, holding
   * the Project against other changes of them until the result is saved. `change` answering
   * undefined saves nothing; throws ProjectNotFound when there is no such Project. `record`, when
   * given, is recorded with what it saves in the same transaction, made from the list before and
   * after.
   */
  abstract update(
    projectId: string,
    change: (targets: readonly TestTarget[]) => Promise<readonly TestTarget[] | undefined>,
    record?: SettingChangeRecording<readonly TestTarget[]>,
  ): Promise<readonly TestTarget[] | undefined>;
}
