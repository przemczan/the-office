import type { TestInstance, TestInstanceChange } from "../domain/test-instance.js";
import { ACTIVE_STATES } from "../domain/test-instance.js";
import { TestInstanceRepository, type BuildsOf } from "./test-instance-repository.js";

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
      newestFirst([...this.rows.values()].filter((each) => each.initiativeId === initiativeId)),
    );
  }

  listOfProject(projectId: string): Promise<readonly TestInstance[]> {
    return Promise.resolve(
      newestFirst([...this.rows.values()].filter((each) => each.projectId === projectId)),
    );
  }

  active(): Promise<readonly TestInstance[]> {
    return Promise.resolve(
      [...this.rows.values()].filter(({ state }) => ACTIVE_STATES.includes(state)),
    );
  }

  endedSince(at: Date): Promise<readonly TestInstance[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter(
          ({ state, endedAt }) =>
            (state === "built" || state === "failed") &&
            endedAt !== undefined &&
            endedAt.getTime() >= at.getTime(),
        )
        .toSorted((one, other) => (other.endedAt?.getTime() ?? 0) - (one.endedAt?.getTime() ?? 0)),
    );
  }

  builtWithFiles(of?: BuildsOf): Promise<readonly TestInstance[]> {
    return Promise.resolve(
      newestFirst(
        [...this.rows.values()].filter(
          (instance) =>
            instance.state === "built" &&
            instance.filesRemovedAt === undefined &&
            (of === undefined || isBuildOf(instance, of)),
        ),
      ),
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

function isBuildOf(instance: TestInstance, of: BuildsOf): boolean {
  if (instance.projectId !== of.projectId || instance.targetKey !== of.targetKey) return false;
  return "initiativeId" in of
    ? instance.initiativeId === of.initiativeId
    : instance.initiativeId === undefined && instance.branch === of.branch;
}

/** Newest first; of two launched together, the one added later first. */
function newestFirst(instances: readonly TestInstance[]): TestInstance[] {
  return instances
    .toReversed()
    .toSorted((one, other) => other.launchedAt.getTime() - one.launchedAt.getTime());
}
