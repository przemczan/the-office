import type { TestTarget } from "../domain/test-target.js";

/** Where each Project's test targets are kept, in the order added (spec §2.12). */
export abstract class TestTargetRepository {
  /** The Project's test targets; none for a Project with none, or no such Project. */
  abstract listOf(projectId: string): Promise<readonly TestTarget[]>;

  /**
   * Replaces the Project's test targets, whole, with what `change` makes of them as stored, holding
   * the Project against other changes of them until the result is saved. `change` answering
   * undefined saves nothing; throws ProjectNotFound when there is no such Project.
   */
  abstract update(
    projectId: string,
    change: (targets: readonly TestTarget[]) => Promise<readonly TestTarget[] | undefined>,
  ): Promise<readonly TestTarget[] | undefined>;
}
