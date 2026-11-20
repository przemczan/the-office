import type { Project } from "./project.js";

/**
 * A Task's Kind (spec §2.1), as Projects knows it: each has its own default Pipeline in a Project,
 * or follows the Project's default Pipeline.
 */
export const TASK_KINDS = ["feature", "bug", "chore"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** Each Kind's own default Pipeline in a Project; null follows the Project's default Pipeline. */
export type KindDefaultPipelines = Readonly<Record<TaskKind, string | null>>;

/** No Kind has a default Pipeline of its own: each follows the Project's. */
export const NO_KIND_DEFAULT_PIPELINES: KindDefaultPipelines = {
  feature: null,
  bug: null,
  chore: null,
};

/**
 * The Pipeline a new Task of `kind` gets in the Project: its Kind's own default, else the
 * Project's default Pipeline. The one resolver: Work's KnownProjects and the read model ask it.
 */
export function defaultPipelineFor(
  project: Pick<Project, "defaultPipeline" | "kindDefaultPipelines">,
  kind: TaskKind,
): string {
  return project.kindDefaultPipelines[kind] ?? project.defaultPipeline;
}

/** Every Kind's default Pipeline in the Project, resolved by `defaultPipelineFor`. */
export function defaultPipelineOfKind(
  project: Pick<Project, "defaultPipeline" | "kindDefaultPipelines">,
): Readonly<Record<TaskKind, string>> {
  return {
    feature: defaultPipelineFor(project, "feature"),
    bug: defaultPipelineFor(project, "bug"),
    chore: defaultPipelineFor(project, "chore"),
  };
}
