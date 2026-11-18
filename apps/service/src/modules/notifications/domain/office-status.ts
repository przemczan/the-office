import type { NeedsYouItem, Now, RunningTask, WaitingStandInChoices } from "./now.js";

const STARTED_STATE_NAMES: Readonly<Record<string, string>> = {
  "in-progress": "In progress",
  "waiting-on-you": "Waiting on you",
  paused: "Paused",
};

/**
 * The Office status in words, for the Office Manager to answer from (spec §2.2): what waits on the
 * user and every started Task with its Stage and person, Office-wide. Whoever is on none is free.
 */
export function officeStatusText({ needsYou, running }: Now): string {
  return [waitingLine(needsYou), ...startedLines(running)].join("\n");
}

function waitingLine(needsYou: readonly NeedsYouItem[]): string {
  const counts = [
    counted(
      needsYou.filter(({ kind }) => kind === "decision" || kind === "initiative-decision").length,
      "Decision",
    ),
    counted(needsYou.filter(({ kind }) => kind === "gate").length, "Gate"),
    standInChoiceWords(needsYou),
  ].filter((count) => count !== undefined);
  return counts.length === 0
    ? "Nothing waits on the user."
    : `Waiting on the user: ${counts.join(", ")}.`;
}

/** The Office's own Decision on the Stages waiting for a Stand-in Engine: one, however many wait. */
function standInChoiceWords(needsYou: readonly NeedsYouItem[]): string | undefined {
  const choice = needsYou.find(
    (item): item is WaitingStandInChoices => item.kind === "stand-in-choice",
  );
  if (!choice) return undefined;
  return `1 Decision on Stages waiting for a Stand-in Engine (${counted(choice.count, "Stage")})`;
}

function counted(count: number, noun: string): string | undefined {
  if (count === 0) return undefined;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function startedLines(running: readonly RunningTask[]): string[] {
  if (running.length === 0) return ["No Task is started: everyone is available."];
  return [
    "Started Tasks (whoever is on none is available):",
    ...running.map((task) => `- ${task.title} (Task ${task.taskId}) · ${taskWords(task)}`),
  ];
}

function taskWords({ state, stage }: RunningTask): string {
  const stateName = STARTED_STATE_NAMES[state] ?? state;
  if (!stage) return `${stateName}, before its first Stage`;
  const who = stage.role === undefined ? "" : `, worked by the Role ${stage.role}`;
  return `${stateName} · Stage ${stage.name}${who}`;
}
