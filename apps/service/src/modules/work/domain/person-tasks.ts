import type { PipelineStage } from "./usage-estimate.js";
import type { Task, TaskState } from "./task.js";

/** The groups of a person's Work tab, as the user asks about their Tasks. */
export const WORK_FILTERS = [
  "all",
  "not-started",
  "in-progress",
  "waiting-on-you",
  "done",
  "dropped",
] as const;
export type WorkFilter = (typeof WORK_FILTERS)[number];

/**
 * The states each Work filter holds; `undefined` for All. Waiting on you also holds a Task in
 * Planning or Paused with a Decision open (spec §9, the web's `waitsOnYou`), which only the open
 * Decisions tell, so it is the one filter that takes more than states (`WAITS_ON_YOU_IN_ITS_STATE`).
 */
export const WORK_FILTER_STATES: Readonly<Record<WorkFilter, readonly TaskState[] | undefined>> = {
  all: undefined,
  "not-started": ["shaping", "backlog", "planning", "ready"],
  "in-progress": ["in-progress", "paused"],
  "waiting-on-you": ["waiting-on-you"],
  done: ["done"],
  dropped: ["dropped"],
};

/** The states in which a Task waits on the user only while a Decision on it is open. */
export const WAITS_ON_YOU_IN_ITS_STATE: readonly TaskState[] = ["planning", "paused"];

/** A Pipeline as the person's part reads it: its Stages, a Project Pipeline's built. */
export interface PipelineWithStages {
  readonly id: string;
  readonly stages: readonly PipelineStage[];
}

/**
 * The names of the Stages the person works in each Pipeline that has any, by its id: those naming
 * their Role, or a duty they hold (task 10).
 */
export function stagesWorkedBy(
  pipelines: readonly PipelineWithStages[],
  roleKey: string,
  heldDuties: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    pipelines.flatMap(({ id, stages }) => {
      const names = stages
        .filter(
          ({ role, duty }) => role === roleKey || (duty !== undefined && heldDuties.has(duty)),
        )
        .map(({ name }) => name);
      return names.length > 0 ? [[id, names] as const] : [];
    }),
  );
}

/**
 * The person's part in the Task, in a few words: "Created it" when they created it (as from a
 * chat), each of their Threads on it by its title (as "Planning"), then the Stages they work, each
 * once. Ownership and Consultations add theirs in later Tasks.
 */
export function partIn(
  task: Pick<Task, "createdBy" | "pipelineId">,
  roleKey: string,
  threadTitles: readonly string[],
  stagesWorked: ReadonlyMap<string, readonly string[]>,
): string {
  const created = task.createdBy.kind === "person" && task.createdBy.roleKey === roleKey;
  const stages = task.pipelineId === undefined ? [] : (stagesWorked.get(task.pipelineId) ?? []);
  return [...new Set([...(created ? ["Created it"] : []), ...threadTitles, ...stages])].join(" · ");
}

/** A Thread on a Task with no title yet, as the person's part names it. */
export const UNTITLED_THREAD = "A Thread";
