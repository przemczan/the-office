import type { Stage, TaskStage } from "@the-office/contracts";

/** The Gate a started Task waits at, with what Continue moves on to and where Send back may go. */
export interface WaitingGate {
  readonly gate: Stage;
  /** The Stage after the Gate; undefined when the Gate is the last. */
  readonly next: Stage | undefined;
  /**
   * The first Agent Stage after the Gate, which notes the user continues with brief first, as every
   * later one; undefined when none comes after it, and so nobody would read notes (spec §2.3).
   */
  readonly nextAgentStage: Stage | undefined;
  /**
   * The Stages before the Gate the work may go back to: none that is a Gate or a Publish (spec
   * §2.3). An Agent reads the feedback; a Script Stage just runs again.
   */
  readonly sendBackTargets: readonly Stage[];
  /** The Stages before the Gate that have run, whose results the Gate shows. */
  readonly earlier: readonly TaskStage[];
}

/** Undefined while the Task waits at no Gate. */
export function waitingGateOf(taskStages: readonly TaskStage[]): WaitingGate | undefined {
  // Acted on, a Gate may still wait on you for a Decision the walk opened on its run, such as the
  // Definition of Done's at the last Stage: that is the Decision's to answer.
  const index = taskStages.findIndex(
    ({ stage, state, runs }) =>
      stage.kind === "gate" && state === "waiting-on-you" && runs.at(-1)?.gateAction === null,
  );
  const waiting = taskStages[index];
  if (!waiting) return undefined;
  const before = taskStages.slice(0, index);
  return {
    gate: waiting.stage,
    next: taskStages[index + 1]?.stage,
    nextAgentStage: taskStages.slice(index + 1).find(({ stage }) => stage.kind === "agent")?.stage,
    sendBackTargets: before.map(({ stage }) => stage).filter(isSendBackTarget),
    earlier: before.filter(({ state }) => state !== "pending"),
  };
}

function isSendBackTarget(stage: Stage): boolean {
  return stage.kind !== "gate" && stage.kind !== "publish";
}

/** The last Agent Stage before the Gate, as the click-through sends back; else the last Stage. */
export function defaultSendBackTarget(targets: readonly Stage[]): Stage | undefined {
  return targets.findLast(({ kind }) => kind === "agent") ?? targets.at(-1);
}

export const SEND_BACK_WITH_NOTES = "Send back with notes…";

/**
 * What the send-back form says for its target: who changes what, or, beside a Script Stage, that it
 * can't read the feedback and only runs again.
 */
export function sendBackWords(
  target: Stage | undefined,
  personName: string,
): { readonly placeholder: string; readonly sent: string; readonly scriptNote?: string } {
  if (target?.kind !== "agent") {
    const name = target?.name ?? "The Stage";
    return {
      placeholder: `What should change? ${name} runs again; your feedback stays on its run.`,
      sent: `Sent back to ${name}: it runs again.`,
      scriptNote: `${name} is a script: it can't read your feedback, it only runs again.`,
    };
  }
  return { placeholder: `What should ${personName} change?`, sent: `Sent back to ${personName}.` };
}

export const CONTINUE_WITH_NOTES = "Continue with notes…";

/**
 * What the notes field asks, naming who works the first Agent Stage after the Gate; every later
 * Agent Stage is briefed with the notes too.
 */
export function continueNotesPlaceholder(personName: string): string {
  return `What should ${personName} know as the work goes on?`;
}

/** "Continue to Publish" (prototypes/app/now.js), or "Continue" at the last Stage. */
export function continueLabel({ next }: WaitingGate): string {
  return next ? `Continue to ${next.name}` : "Continue";
}
