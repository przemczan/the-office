/**
 * The sessions behind a Task's Threads, which Conversations runs; the composition root binds it.
 * Publish ends them before it removes the worktree they work in: on Windows a folder a process
 * works in can't be deleted.
 */
export abstract class TaskThreadSessions {
  /** Ends the sessions of the Task's Threads that wait for the user's next message. */
  abstract endWaiting(taskId: string): Promise<void>;
}
