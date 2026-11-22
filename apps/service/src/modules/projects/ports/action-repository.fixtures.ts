import type { Action } from "../domain/action.js";
import { ActionRepository } from "./action-repository.js";

/** Each Project's Actions in memory, for tests that keep their Projects in memory too. */
export class InMemoryActionRepository extends ActionRepository {
  private readonly byProject = new Map<string, readonly Action[]>();

  async listOf(projectId: string): Promise<readonly Action[]> {
    return this.byProject.get(projectId) ?? [];
  }

  async update(
    projectId: string,
    change: (actions: readonly Action[]) => Promise<readonly Action[] | undefined>,
  ): Promise<readonly Action[] | undefined> {
    const changed = await change(this.byProject.get(projectId) ?? []);
    if (changed !== undefined) this.byProject.set(projectId, changed);
    return changed;
  }

  /** Sets the Project's Actions as if saved. */
  keep(projectId: string, actions: readonly Action[]): void {
    this.byProject.set(projectId, actions);
  }
}
