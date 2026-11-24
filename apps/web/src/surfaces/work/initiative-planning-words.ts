import type { Decision, Initiative, TaskSummary, Thread } from "@the-office/contracts";

/**
 * Where a Task of an Initiative being planned (Plan the Initiative) stands: waiting in Backlog for
 * its turn, being planned, waiting for the user's answer to a Decision on it, planned and waiting
 * for the user's Confirm, or Ready.
 */
export type PlanningStep = "waiting" | "planning" | "answer-awaited" | "planned" | "ready";

export const PLANNING_STEP_WORDS: Readonly<Record<PlanningStep, string>> = {
  waiting: "Waiting",
  planning: "Planning",
  "answer-awaited": "Waiting for your answer",
  planned: "Planned, waiting for your Confirm",
  ready: "Ready",
};

/**
 * The Task's planning step while its Initiative has a planning Thread; undefined before it has
 * one, and for a Task past Ready, Dropped or in Shaping, which planning no longer concerns. A
 * Decision open on the Task (`openDecisions`, those waiting on the user) comes before any other
 * step until it is answered.
 */
export function planningStepOf(
  initiative: Initiative,
  task: TaskSummary,
  openDecisions: readonly Pick<Decision, "taskId">[],
): PlanningStep | undefined {
  const step = stepByState(initiative, task);
  if (step === undefined) return undefined;
  return openDecisions.some(({ taskId }) => taskId === task.id) ? "answer-awaited" : step;
}

function stepByState(initiative: Initiative, task: TaskSummary): PlanningStep | undefined {
  if (initiative.planningThreadId === null) return undefined;
  switch (task.state) {
    case "backlog":
      return "waiting";
    case "planning":
      return task.markedPlanned ? "planned" : "planning";
    case "ready":
      return "ready";
    default:
      return undefined;
  }
}

/**
 * The head's summary while the Initiative has a planning Thread, such as "3 of 5 Tasks planned":
 * of its Tasks in Backlog, Planning or Ready, those marked planned or Ready; then how many wait for
 * the user's answer, when any does, as "3 of 5 Tasks planned · 1 waiting for your answer".
 */
export function planningProgressWords(
  initiative: Initiative,
  initiativeTasks: readonly TaskSummary[],
  openDecisions: readonly Pick<Decision, "taskId">[],
): string | undefined {
  const steps = initiativeTasks
    .map((task) => planningStepOf(initiative, task, openDecisions))
    .filter((step) => step !== undefined);
  if (steps.length === 0) return undefined;
  const planned = steps.filter((step) => step === "planned" || step === "ready").length;
  const awaited = steps.filter((step) => step === "answer-awaited").length;
  return [
    `${planned} of ${steps.length} ${steps.length === 1 ? "Task" : "Tasks"} planned`,
    ...(awaited > 0 ? [`${awaited} waiting for your answer`] : []),
  ].join(" · ");
}

/**
 * Why Plan the Initiative and Plan with… are disabled: the Initiative's latest planning Thread is
 * answering, its person's turn running, so the user writes there instead (the service refuses them
 * with the same words). Undefined otherwise: a Thread waiting for the user, or for a Decision's
 * answer, isn't working.
 */
export function stillPlanningReason(
  initiative: Pick<Initiative, "planningThreadId">,
  initiativeThreads: readonly Pick<Thread, "id" | "state">[] | undefined,
  planner: string,
): string | undefined {
  const latest = initiativeThreads?.find(({ id }) => id === initiative.planningThreadId);
  if (latest?.state !== "answering") return undefined;
  return `${planner} is still planning in the planning Thread: write there, or wait until they finish.`;
}

/**
 * Whether Plan the Initiative is offered: on an active Initiative with a Task in Backlog. The
 * service refuses it for the other reasons, which show as its answer.
 */
export function canPlanInitiative(
  initiative: Initiative,
  initiativeTasks: readonly TaskSummary[],
): boolean {
  return initiative.state === "active" && initiativeTasks.some(({ state }) => state === "backlog");
}
