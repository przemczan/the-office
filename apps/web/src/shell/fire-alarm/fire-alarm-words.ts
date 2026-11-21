import type { FireAlarmOnNow, FireAlarmWay, TaskResume } from "@the-office/contracts";
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

/** A way to sound the alarm, as the top bar's menu offers it. */
export interface FireAlarmWayWords {
  readonly way: FireAlarmWay;
  readonly label: string;
  readonly hint: string;
}

/** The three ways to sound the alarm, strictest first, as the contract orders them. */
export const FIRE_ALARM_WAYS: readonly FireAlarmWayWords[] = [
  {
    way: "asap",
    label: "Safe pause ASAP",
    hint: "Every Stage stops at its next safe point; chats lose their tools.",
  },
  {
    way: "after-stages",
    label: "Safe pause after the current Stages",
    hint: "Running Stages finish; no new Stage starts.",
  },
  {
    way: "after-tasks",
    label: "Safe pause after the current Tasks",
    hint: "Started Tasks finish; no new Task starts.",
  },
];

/** The ways stricter than `way`, which is all the service lets the alarm go to while it is on. */
export function stricterWays(way: FireAlarmWay): readonly FireAlarmWayWords[] {
  return FIRE_ALARM_WAYS.slice(
    0,
    FIRE_ALARM_WAYS.findIndex((each) => each.way === way),
  );
}

/** Whether chats lose their tools under the alarm: only ASAP; the softer ways leave them as usual. */
export function alarmHoldsChats(alarm: { readonly way: FireAlarmWay } | null | undefined): boolean {
  return alarm?.way === "asap";
}

const SOUNDED_TAILS: Readonly<Record<FireAlarmWay, string>> = {
  asap: "every Stage stops at its next safe point.",
  "after-stages": "running Stages finish, then no new Stage starts.",
  "after-tasks": "started Tasks finish, then no new Task starts.",
};

/** The toast once the alarm is sounded in `way`, or made stricter to it. */
export function soundedWords(way: FireAlarmWay, stricter: boolean): string {
  if (stricter) return `Alarm made stricter: ${SOUNDED_TAILS[way]}`;
  const chats = way === "asap" ? "Chats stay open." : "Chats keep their tools.";
  return `Alarm sounded: ${SOUNDED_TAILS[way]} ${chats}`;
}

/** The title of the notice when the service refuses to sound the alarm or make it stricter. */
export function soundRefusedWords(stricter: boolean): string {
  return stricter ? "The alarm wasn't made stricter" : "The alarm wasn't sounded";
}

const WAY_LINES: Readonly<Record<Exclude<FireAlarmWay, "asap">, string>> = {
  "after-stages": "stopping after the current Stages",
  "after-tasks": "finishing the current Tasks",
};

/** The panel's heading: under ASAP stopping, then on since it sounded; else on since, the way it is. */
export function alarmStateWords(alarm: FireAlarmOnNow): string {
  if (alarm.way !== "asap")
    return `Alarm on since ${clockOf(alarm.since)} · ${WAY_LINES[alarm.way]}`;
  return alarm.stopping
    ? "Alarm on · stopping at safe points"
    : `Alarm on since ${clockOf(alarm.since)}`;
}

const WAY_FIGURES: Readonly<Record<Exclude<FireAlarmWay, "asap">, string>> = {
  "after-stages": "Stopping after Stages",
  "after-tasks": "Stopping after Tasks",
};

/**
 * The strip's Fire alarm figure: under ASAP "Stopping at safe points", then "On since 14:02"; under
 * a softer way, the way it stops.
 */
export function alarmFigureWords(alarm: FireAlarmOnNow): string {
  if (alarm.way !== "asap") return WAY_FIGURES[alarm.way];
  return alarm.stopping ? "Stopping at safe points" : `On since ${clockOf(alarm.since)}`;
}

/** The badge of a started Task a softer way lets go on, on Now's alarm panel. */
export const GOING_ON_BADGES: Readonly<Record<Exclude<FireAlarmWay, "asap">, string>> = {
  "after-stages": "Stopping after its Stage",
  "after-tasks": "Finishing its Task",
};

/** What a Task the alarm holds is called, wherever its state shows. */
export const PAUSED_BY_THE_ALARM = "Paused by the alarm";
