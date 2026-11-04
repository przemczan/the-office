import type { Decision, TaskState } from "@the-office/contracts";

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

export function nothingNeedsYouWords(state: TaskState): string {
  return state === "done"
    ? "Nothing needs you: this Task is Done."
    : "Nothing needs you right now. You'll see it here first.";
}
