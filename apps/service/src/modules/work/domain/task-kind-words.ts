import type { TaskKind } from "./task.js";

/** A Kind as Briefs and the read tools name it. */
export const TASK_KIND_NAMES: Readonly<Record<TaskKind, string>> = {
  feature: "Feature",
  bug: "Bug",
  chore: "Chore",
};

/** Tasks of a Kind, as "the Pipeline a Project gives Bugs" names them. */
export const TASK_KIND_PLURALS: Readonly<Record<TaskKind, string>> = {
  feature: "Features",
  bug: "Bugs",
  chore: "Chores",
};

/** The Conventional Commits type a Task of the Kind suggests for its commit message. */
export const COMMIT_TYPES: Readonly<Record<TaskKind, string>> = {
  feature: "feat",
  bug: "fix",
  chore: "chore",
};
