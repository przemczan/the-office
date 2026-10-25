/**
 * How many of a person's Agents may work Stages at once; "none" means the person only talks and no
 * Pipeline may name the Role (spec §2.2).
 */
export type TaskLimit = number | "none";

export const LOWEST_TASK_LIMIT = 1;
export const HIGHEST_TASK_LIMIT = 6;

/** Why a Task limit can't be saved, or undefined when it can. */
export function taskLimitProblem(limit: TaskLimit): string | undefined {
  if (limit === "none") return undefined;
  if (Number.isInteger(limit) && limit >= LOWEST_TASK_LIMIT && limit <= HIGHEST_TASK_LIMIT) {
    return undefined;
  }
  return `A Task limit is ${LOWEST_TASK_LIMIT} to ${HIGHEST_TASK_LIMIT} Tasks at once, or none.`;
}
