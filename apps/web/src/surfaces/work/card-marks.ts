import type { TaskState } from "@the-office/contracts";

/**
 * One mark in a board card's row (docs/design/task-card-icons.html, Foot row): what needs the user,
 * then what holds the Task, then the quiet ones, then who works on it or Plan at the right end.
 */
export type CardMark =
  | { readonly kind: "waiting-on-you" }
  | { readonly kind: "paused" }
  | { readonly kind: "dropped" }
  | { readonly kind: "blocked"; readonly count: number }
  | { readonly kind: "queued" }
  | { readonly kind: "planning" }
  | { readonly kind: "usage-estimate" }
  | { readonly kind: "working" }
  | { readonly kind: "plan" };

export interface CardFacts {
  readonly state: TaskState;
  /** In Planning or Paused with a Decision open. */
  readonly waiting: boolean;
  readonly blockers: number;
  readonly queued: boolean;
  readonly hasUsageEstimate: boolean;
  readonly someoneWorking: boolean;
  /** Whether someone is the Planner, as Plan is refused otherwise. */
  readonly hasPlanner: boolean;
}

/** The card's marks after its Project's, in their order; a state its column names shows none. */
export function cardMarks(facts: CardFacts): readonly CardMark[] {
  const marks: CardMark[] = [...needsTheUser(facts)];
  if (facts.blockers > 0) marks.push({ kind: "blocked", count: facts.blockers });
  if (facts.queued) marks.push({ kind: "queued" });
  if (facts.state === "planning" && !facts.waiting) marks.push({ kind: "planning" });
  if (facts.hasUsageEstimate) marks.push({ kind: "usage-estimate" });
  if (facts.someoneWorking) marks.push({ kind: "working" });
  else if (facts.state === "backlog" && facts.hasPlanner) marks.push({ kind: "plan" });
  return marks;
}

function needsTheUser({ state, waiting }: CardFacts): readonly CardMark[] {
  switch (state) {
    case "waiting-on-you":
      return [{ kind: "waiting-on-you" }];
    case "planning":
      return waiting ? [{ kind: "waiting-on-you" }] : [];
    // Held with a Decision its Agent opened before: Paused and Waiting on you at once (spec §2.4).
    case "paused":
      return waiting ? [{ kind: "waiting-on-you" }, { kind: "paused" }] : [{ kind: "paused" }];
    case "dropped":
      return [{ kind: "dropped" }];
    default:
      return [];
  }
}
