import type { Initiative, Task, TaskSummary } from "@the-office/contracts";
import type { ControlBarWords } from "./record-actions.tsx";

function tasksCount(count: number): string {
  return count === 1 ? "1 Task" : `${count} Tasks`;
}

/**
 * What a Task's control bar says about where it is, by its state, and why its buttons are
 * offered (docs/spec/screens/task-page.md, "Control bar"). `planner` and `queued` name what the
 * state alone doesn't tell.
 */
export function taskBarWords(
  task: Pick<Task, "state" | "pausedBy">,
  { planner, queuedPlace }: { readonly planner?: string; readonly queuedPlace?: number },
): ControlBarWords {
  switch (task.state) {
    case "shaping":
      return {
        lead: "Shaping.",
        words: "It is drafted with its Initiative; confirming the Initiative moves it to Backlog.",
        icon: "lightbulb",
        tone: "plan",
      };
    case "backlog":
      return {
        lead: "Backlog.",
        words: planner
          ? `Plan it with ${planner}, or mark it Ready as it stands.`
          : "Mark it Ready as it stands.",
        icon: "circle-dashed",
      };
    case "planning":
      return {
        lead: "Planning.",
        words: planner ? `${planner} is making its plan.` : "Its plan is being made.",
        icon: "map",
        tone: "plan",
      };
    case "ready":
      return queuedPlace === undefined
        ? { lead: "Ready.", words: "Start it to begin its Pipeline.", icon: "circle-check" }
        : { lead: `Queued, place ${queuedPlace}.`, icon: "clock", tone: "hold" };
    case "in-progress":
      return {
        lead: "In progress.",
        words: "Pause holds it once the Agent's turn ends; Stop interrupts it now.",
        icon: "circle-dot",
        tone: "plan",
      };
    case "waiting-on-you":
      return {
        lead: "Waiting on you.",
        words: "A Decision or a Gate needs you; Pause or Stop hold it meanwhile.",
        icon: "circle-dot",
        tone: "plan",
      };
    case "paused":
      return {
        lead: "Paused.",
        words:
          task.pausedBy === null
            ? "Resume goes on from where you paused it, or pick another way back from its menu."
            : "The Office holds it and goes on by itself when it can.",
        icon: "circle-pause",
        tone: "hold",
      };
    case "done":
      return { lead: "Done.", icon: "circle-check", tone: "go" };
    case "dropped":
      return { lead: "Dropped.", icon: "circle-x" };
  }
}

/** What waits for a step of the user's in an active Initiative, each count only when it has any. */
function activeWords(ready: number, backlog: number): string {
  const parts = [
    ...(ready > 0 ? [`${tasksCount(ready)} ${ready === 1 ? "is" : "are"} Ready to start`] : []),
    ...(backlog > 0
      ? [`${tasksCount(backlog)} ${backlog === 1 ? "waits" : "wait"} in Backlog for a Plan`]
      : []),
  ];
  return parts.length === 0 ? "Its Tasks are on their way." : `${parts.join(", and ")}.`;
}

/** What an Initiative's control bar says about where it is, by its state and its Tasks. */
export function initiativeBarWords(
  initiative: Pick<Initiative, "state" | "pausedAt">,
  tasks: readonly Pick<TaskSummary, "state">[],
  { shaper, planner }: { readonly shaper?: string; readonly planner?: string },
): ControlBarWords {
  const count = (state: TaskSummary["state"]): number =>
    tasks.filter((task) => task.state === state).length;
  switch (initiative.state) {
    case "shaping":
      return {
        lead: shaper ? `Shaping with ${shaper}.` : "Shaping.",
        words: `Confirm it to move its ${tasksCount(count("shaping"))} to Backlog${
          planner ? `, for ${planner} to plan` : ""
        }.`,
        icon: "lightbulb",
        tone: "plan",
      };
    case "active":
      if (initiative.pausedAt !== null) {
        return {
          lead: "Paused.",
          words: "None of its Tasks starts until you resume it.",
          icon: "circle-pause",
          tone: "hold",
        };
      }
      return {
        lead: "Active.",
        words: activeWords(count("ready"), count("backlog")),
        icon: "circle-dot",
        tone: "plan",
      };
    case "done":
      return {
        lead: "Done.",
        words: `${count("done")} of ${tasksCount(tasks.filter((task) => task.state !== "dropped").length)} done.`,
        icon: "circle-check",
        tone: "go",
      };
    case "dropped":
      return { lead: "Dropped.", icon: "circle-x" };
  }
}
