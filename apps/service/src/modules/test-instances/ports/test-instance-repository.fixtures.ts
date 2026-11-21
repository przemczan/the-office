import type { TestInstance, TestInstanceChange } from "../domain/test-instance.js";
import { ACTIVE_STATES } from "../domain/test-instance.js";
import { TestInstanceRepository } from "./test-instance-repository.js";

/**
 * The rows in memory, so a test's limit, ports and sweep weigh its own instances alone: every test
 * file shares the database's `test_instances`.
 */
export class TestInstanceRepositoryForTests extends TestInstanceRepository {
  readonly rows = new Map<string, TestInstance>();

  add(instance: TestInstance): Promise<void> {
    this.rows.set(instance.id, instance);
    return Promise.resolve();
  }

  find(id: string): Promise<TestInstance | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  listOf(initiativeId: string): Promise<readonly TestInstance[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((instance) => instance.initiativeId === initiativeId)
        .toReversed()
        .toSorted((one, other) => other.launchedAt.getTime() - one.launchedAt.getTime()),
    );
  }

  active(): Promise<readonly TestInstance[]> {
    return Promise.resolve(
      [...this.rows.values()].filter(({ state }) => ACTIVE_STATES.includes(state)),
    );
  }

  update(
    id: string,
    change: (instance: TestInstance) => TestInstanceChange,
  ): Promise<TestInstanceChange> {
    const kept = this.rows.get(id);
    if (!kept) return Promise.resolve(undefined);
    const changed = change(kept);
    if (changed) this.rows.set(id, changed.instance);
    return Promise.resolve(changed);
  }
}
