import type { EventBus } from "../../../platform/events/event-bus.js";
import type { DependencyChanges } from "../domain/task-dependencies.js";

/**
 * Publishes, once they are saved, a TaskDependencyAdded or TaskDependencyRemoved for each link an
 * added dependency changed, Task by Task in the order they were changed.
 */
export async function publishDependencyChanges(
  events: EventBus,
  { changed }: DependencyChanges,
): Promise<void> {
  for (const event of changed.flatMap((each) => each.events)) await events.publish(event);
}
