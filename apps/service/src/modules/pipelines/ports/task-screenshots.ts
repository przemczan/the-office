/** The screenshots attached, by their names, or why none was. */
export type ScreenshotsAttaching =
  | { readonly kind: "attached"; readonly names: readonly string[] }
  | { readonly kind: "refused"; readonly problems: readonly string[] };

/**
 * The screenshots an Agent lists in its Stage's result, which Work attaches to the Task; the
 * composition root binds it.
 */
export abstract class TaskScreenshots {
  /**
   * Attaches exactly `paths`, relative to the worktree's screenshots folder, in the name of the
   * person in `roleKey`; all or none, refused with every problem in words the Agent can correct.
   */
  abstract attach(
    taskId: string,
    roleKey: string,
    paths: readonly string[],
  ): Promise<ScreenshotsAttaching>;
}
