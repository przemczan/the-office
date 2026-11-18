import type { Decision, TaskState } from "@the-office/contracts";

const NOTHING_NEEDS_YOU = "Nothing needs you right now. You'll see it here first.";

/** Where a Task in Shaping stands, on its Needs you card and in its conversation. */
export const WAITS_FOR_ITS_INITIATIVE =
  "Waiting for its Initiative to be confirmed: it can't be planned or started until then.";

/** The Needs you card's element, for a link that leads to it. */
export const NEEDS_YOU_ELEMENT_ID = "task-needs-you";

/** A Decision with a Consultant waits on them, so it isn't counted, though the user may take it over. */
export function waitingOnYou(decisions: readonly Decision[]): readonly Decision[] {
  return decisions.filter(({ putTo }) => putTo === null);
}

/**
 * The card's head: how many Decisions wait on the user, the Gate, The Office's Decision on a
 * Stand-in Engine, then how many on a Consultant.
 */
export function needsYouSummary(
  decisions: readonly Decision[],
  atGate: boolean,
  standInChoice = false,
): string {
  const onYou = waitingOnYou(decisions).length;
  const onConsultants = decisions.length - onYou;
  return [
    ...(onYou > 0 ? [`${onYou} ${onYou === 1 ? "Decision" : "Decisions"}`] : []),
    ...(atGate ? ["a Gate"] : []),
    ...(standInChoice ? ["a Stand-in Engine choice"] : []),
    ...(onConsultants > 0 ? [`${onConsultants} waiting on a Consultant`] : []),
  ].join(" · ");
}

/** What the card's place says when nothing waits: where the Task stands. */
export function needsYouClearWords(state: TaskState, queued: boolean): string {
  switch (state) {
    case "done":
      return "Nothing needs you: this Task is Done.";
    case "dropped":
      return "This Task was dropped.";
    case "shaping":
      return WAITS_FOR_ITS_INITIATIVE;
    case "ready":
      return queued
        ? NOTHING_NEEDS_YOU
        : "Ready: start it when you want; nothing starts by itself.";
    default:
      return NOTHING_NEEDS_YOU;
  }
}
