import type { Decision, TaskState } from "@the-office/contracts";

const NOTHING_NEEDS_YOU = "Nothing needs you right now. You'll see it here first.";

/** The Needs you card's element, for a link that leads to it. */
export const NEEDS_YOU_ELEMENT_ID = "task-needs-you";

/** A Decision with a Consultant waits on them, so it isn't counted, though the user may take it over. */
export function waitingOnYou(decisions: readonly Decision[]): readonly Decision[] {
  return decisions.filter(({ putTo }) => putTo === null);
}

/** The card's head: how many Decisions wait on the user, the Gate, then how many on a Consultant. */
export function needsYouSummary(decisions: readonly Decision[], atGate: boolean): string {
  const onYou = waitingOnYou(decisions).length;
  const onConsultants = decisions.length - onYou;
  return [
    ...(onYou > 0 ? [`${onYou} ${onYou === 1 ? "Decision" : "Decisions"}`] : []),
    ...(atGate ? ["a Gate"] : []),
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
    case "ready":
      return queued
        ? NOTHING_NEEDS_YOU
        : "Ready: start it when you want; nothing starts by itself.";
    default:
      return NOTHING_NEEDS_YOU;
  }
}
