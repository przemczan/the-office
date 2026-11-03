import { inArray } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { ProviderOverride } from "../../../../../test/test-application.js";
import type { QueuedTask, Release, Starting } from "../../domain/queue.js";
import type { Task } from "../../domain/task.js";
import type { HeldAtStart } from "../../domain/task-start.js";
import { FireAlarmRepository } from "../../ports/fire-alarm-repository.js";
import { QueueRepository, type HeldForRelease } from "../../ports/queue-repository.js";
import { PostgresQueueRepository } from "./postgres-queue-repository.js";
import { tasks } from "./work.schema.js";

/**
 * The queue on the shared database, narrowed to the test's own Projects: every app with Work releases
 * the queue on its own events and weighs each queued Task by its own stand-ins, so without this one
 * file's release starts or refuses another file's queued Tasks, and another file's started Tasks take
 * this one's desks (apps/service/docs/testing.md).
 */
export class OwnProjectsQueueRepository extends PostgresQueueRepository {
  constructor(
    private readonly ownDatabase: Database,
    fireAlarm: FireAlarmRepository,
    private readonly ownProjectIds: () => readonly string[],
  ) {
    super(ownDatabase, fireAlarm);
  }

  override async list(): Promise<readonly QueuedTask[]> {
    const own = await this.ownTaskIds();
    return (await super.list()).filter(({ taskId }) => own.has(taskId));
  }

  override async start(
    id: string,
    decide: (task: Task, held: HeldAtStart, queue: readonly QueuedTask[]) => Starting,
  ): Promise<Starting> {
    const own = await this.ownTaskIds();
    return super.start(id, (task, held, queue) =>
      decide(
        task,
        {
          ...held,
          startedTasks: held.startedTasks.filter(({ projectId }) => this.isOwn(projectId)),
        },
        queue.filter(({ taskId }) => own.has(taskId)),
      ),
    );
  }

  override release(
    decide: (queue: readonly QueuedTask[], held: HeldForRelease) => Release,
  ): Promise<Release> {
    return super.release((queue, held) => {
      // A queued Task's blockers are its own Project's in the tests that queue.
      const ownTasks = held.tasks.filter((task) => this.isOwn(task.projectId));
      const own = new Set(ownTasks.map((task) => task.id));
      return decide(
        queue.filter(({ taskId }) => own.has(taskId)),
        { ...held, tasks: ownTasks },
      );
    });
  }

  override async reorder(
    change: (queue: readonly QueuedTask[]) => readonly QueuedTask[],
  ): Promise<void> {
    const own = await this.ownTaskIds();
    await super.reorder((queue) => change(queue.filter(({ taskId }) => own.has(taskId))));
  }

  private isOwn(projectId: string): boolean {
    return this.ownProjectIds().includes(projectId);
  }

  /** A Task never changes Project, so its ids may be read before the hold. */
  private async ownTaskIds(): Promise<Set<string>> {
    const projectIds = this.ownProjectIds();
    if (projectIds.length === 0) return new Set();
    const rows = await this.ownDatabase
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.projectId, [...projectIds]));
    return new Set(rows.map(({ id }) => id));
  }
}

/** The queue as the test's own Projects see it; with none, a test app's releases touch nothing. */
export function ownProjectsQueue(
  ownProjectIds: () => readonly string[] = () => [],
): ProviderOverride {
  return {
    provide: QueueRepository,
    useFactory: (database: Database, fireAlarm: FireAlarmRepository) =>
      new OwnProjectsQueueRepository(database, fireAlarm, ownProjectIds),
    inject: [DATABASE, FireAlarmRepository],
  };
}
