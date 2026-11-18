import type { StandInChoice, StandInSwitchResult } from "@the-office/contracts";
import { tokensShort } from "../conversation/context-words.ts";
import { momentWords } from "../time.ts";

/**
 * The words of The Office's own Decision on the Stages held as their engine's usage window was used
 * up, whose context is over the size Settings › Engines asks first above (spec 5.4): switch each to
 * a Stand-in Engine now, or let it wait for the reset.
 */

export const STAND_IN_CHOICE_TITLE = "Decision: switch Stages to a Stand-in Engine";

export const SWITCH_NOW = "Switch now";

export const SWITCH_ALL_NOW = "Switch all now";

/**
 * "Their context is over the 100,000 tokens set in Settings › Engines, so the stand-in reads it all
 * again without a prompt cache." One Stage's is "Its context".
 */
export function standInContextLine(choices: readonly Pick<StandInChoice, "askAbove">[]): string {
  const askAbove = choices[0]?.askAbove ?? 0;
  const whose = choices.length === 1 ? "Its" : "Their";
  return `${whose} context is over the ${askAbove.toLocaleString("en-US")} tokens set in Settings › Engines, so the stand-in reads it all again without a prompt cache.`;
}

/** "182k context": the session's context when its turn was refused. */
export function contextSizeWords({ contextTokens }: Pick<StandInChoice, "contextTokens">): string {
  return `${tokensShort(contextTokens)} context`;
}

/** "Claude Code ran out; resets at 14:00", the reset in local time. */
export function ranOutWords(
  { engineName, resetsAt }: Pick<StandInChoice, "engineName" | "resetsAt">,
  now: Date = new Date(),
): string {
  return `${engineName} ran out; resets at ${momentWords(resetsAt, now)}`;
}

export const NO_ROOM = "No Stand-in Engine has room now";

/** "Moves to Claude Code 2", the first Stand-in Engine with room; or that none has room now. */
export function standInWords({ standIn }: Pick<StandInChoice, "standIn">): string {
  return standIn ? `Moves to ${standIn.engineName}` : NO_ROOM;
}

/** "Waits for the reset at 14:00": a Stage not switched. */
export function waitsForResetWords(
  { resetsAt }: Pick<StandInChoice, "resetsAt">,
  now: Date = new Date(),
): string {
  return `Waits for the reset at ${momentWords(resetsAt, now)}`;
}

/**
 * Whether a switch's result takes its Stage off the card without its going on there: its session
 * moved but the Task didn't resume, or it no longer waited. Its words can't show beside a row that
 * is gone, so they come as a notice.
 */
export function leftWithoutGoingOn({ outcome }: Pick<StandInSwitchResult, "outcome">): boolean {
  return (
    outcome === "moved-not-resumed" ||
    outcome === "already-resumed" ||
    outcome === "no-longer-waiting"
  );
}

/** "Implement · Add a filter", whose result a notice tells. */
export function choiceName({
  stageName,
  taskTitle,
}: Pick<StandInChoice, "stageName" | "taskTitle">): string {
  return `${stageName} · ${taskTitle}`;
}

/** Why a Stage's Switch now can't be pressed, said on hover; nothing while it can. */
export function whySwitchDisabled(
  { standIn }: Pick<StandInChoice, "standIn">,
  switching: boolean,
): string | undefined {
  if (switching) return "A switch is under way.";
  return standIn ? undefined : `${NO_ROOM}.`;
}

/** Why Switch all now can't be pressed: a switch under way, or no Stand-in Engine with room. */
export function whySwitchAllDisabled(
  choices: readonly Pick<StandInChoice, "standIn">[],
  switching: boolean,
): string | undefined {
  if (switching) return "A switch is under way.";
  return choices.some(({ standIn }) => standIn) ? undefined : `${NO_ROOM}.`;
}

/**
 * The rows shown: those of one Task on its page, or those in the Projects the filter shows in Needs
 * you.
 */
export function shownChoices(
  choices: readonly StandInChoice[],
  { taskId, projectShown }: ChoiceNarrowing,
): readonly StandInChoice[] {
  return choices.filter(
    (choice) =>
      (taskId === undefined || choice.taskId === taskId) &&
      (projectShown === undefined || projectShown(choice.projectId)),
  );
}

export interface ChoiceNarrowing {
  /** On a Task's page, only that Task's Stages. */
  readonly taskId?: string | undefined;
  /** In Needs you, only the Stages of the Projects the filter shows. */
  readonly projectShown?: ((projectId: string) => boolean) | undefined;
}
