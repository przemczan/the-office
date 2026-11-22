import type { Action } from "../domain/action.js";

/** Where each Project's Actions are kept, in the order added (spec §2.15). */
export abstract class ActionRepository {
  /** The Project's Actions; none for a Project with none, or no such Project. */
  abstract listOf(projectId: string): Promise<readonly Action[]>;

  /**
   * Replaces the Project's Actions, whole, with what `change` makes of them as stored, holding the
   * Project against other changes of them until the result is saved. `change` answering undefined
   * saves nothing; throws ProjectNotFound when there is no such Project.
   */
  abstract update(
    projectId: string,
    change: (actions: readonly Action[]) => Promise<readonly Action[] | undefined>,
  ): Promise<readonly Action[] | undefined>;
}
