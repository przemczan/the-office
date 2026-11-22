import type { Task } from "./task.js";

/**
 * Whether the Task is its Project's "Set up test targets" Task and neither Done nor Dropped. The
 * Office makes no new one: the Project page asks in a chat instead (spec §2.12, "Set up test
 * targets"), and one made before keeps working.
 */
export function isOpenTestTargetsSetUp(task: Task): boolean {
  return task.madeFor === "test-targets-setup" && task.state !== "done" && task.state !== "dropped";
}
