import type { FireAlarmOnNow, TaskResume } from "@the-office/contracts";
import { tokensShort } from "../conversation/context-words.ts";
import { clockOf } from "../time.ts";

/** What the user chooses for a Task the alarm paused, before the all clear. */
export type AllClearChoice = "resume" | "hold" | "drop";

export const ALL_CLEAR_CHOICES: readonly {
  readonly choice: AllClearChoice;
  readonly label: string;
}[] = [
  { choice: "resume", label: "Resume" },
  { choice: "hold", label: "Hold" },
  { choice: "drop", label: "Drop" },
];

/** The pill a resume shows: how the session goes on, or that no model is called. */
export type ResumePill = "warm" | "fresh" | "script";

export interface ResumeWords {
  readonly pill: ResumePill;
  readonly pillLabel: string;
  readonly line: string;
}

const PILL_LABELS: Readonly<Record<ResumePill, string>> = {
  warm: "Continues",
  fresh: "Fresh",
  script: "Script",
};

/** How the Task goes on at the all clear, as the plan shows it (spec §2.5, §2.8). */
export function resumeWords(resume: TaskResume): ResumeWords {
  const [pill, line] = resumePillAndLine(resume);
  return { pill, pillLabel: PILL_LABELS[pill], line };
}

function resumePillAndLine({
  kind,
  stageName,
  contextTokens,
  briefTokens,
}: TaskResume): [ResumePill, string] {
  switch (kind) {
    case "continues-warm":
      return [
        "warm",
        `Continues the same session · cache still warm · ${tokensShort(contextTokens)} read from cache`,
      ];
    case "re-caches":
      return [
        "warm",
        `Continues the same session · cache expired · re-caches ${tokensShort(contextTokens)}`,
      ];
    case "fresh":
      return ["fresh", `Starts fresh · brief and Handover note ~${tokensShort(briefTokens)}`];
    case "script":
      return ["script", `Runs the ${stageName ?? "Stage's"} script again · no model call`];
    case "publish-finished":
      return [
        "script",
        "Its push finished during the alarm; Publish records the result · no model call",
      ];
    case "waits-on-you":
      return ["script", "Waits on you again · no model call"];
    case "goes-on":
      return ["script", `Goes on${stageName ? ` with ${stageName}` : ""} · no model call`];
  }
}

/** The plan's foot: how many resume, about how many tokens before work continues, and the rest. */
export function allClearSummary(resuming: number, tokens: number, setAside: number): string {
  const resumes = `${resuming} to resume · about ${tokensShort(tokens)} tokens before work continues`;
  return setAside > 0 ? `${resumes} · ${setAside} held or dropped` : resumes;
}

/** The panel's heading: stopping, then on since it sounded. */
export function alarmStateWords(alarm: FireAlarmOnNow): string {
  return alarm.stopping
    ? "Alarm on · stopping at safe points"
    : `Alarm on since ${clockOf(alarm.since)}`;
}

/** The strip's Fire alarm figure: "Stopping at safe points", then "On since 14:02". */
export function alarmFigureWords(alarm: FireAlarmOnNow): string {
  return alarm.stopping ? "Stopping at safe points" : `On since ${clockOf(alarm.since)}`;
}

/** What a Task the alarm holds is called, wherever its state shows. */
export const PAUSED_BY_THE_ALARM = "Paused by the alarm";
