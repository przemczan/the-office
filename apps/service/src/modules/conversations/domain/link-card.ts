/** The Task a Link card points the user to someone about. */
export interface LinkedTask {
  readonly taskId: string;
  readonly title: string;
}

/**
 * The Handover note as the Link card gives it: about a Task, it links to the Task's page as the
 * web's `@` picker does, so the session the user's message starts gets the Task's record as with
 * any mention (spec §2.4). A note that links to the Task already is kept as written.
 */
export function linkCardNote(note: string, task: LinkedTask | undefined): string {
  const trimmed = note.trim();
  if (!task) return trimmed;
  const path = `/tasks/${task.taskId}`;
  if (trimmed.includes(path)) return trimmed;
  const title = task.title.replace(/[[\]\\]/g, "\\$&");
  return `${trimmed}\n\n[${title}](${path})`;
}
