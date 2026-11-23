import type { ProposedRoutes, Route, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { choiceCondition } from "./flow-model.ts";
import {
  proposalFlow,
  routesOutSentence,
  routeWhenAfterTarget,
  sourceOf,
  type ProposedStageRoutes,
} from "./proposal-flow.ts";

const review: Stage = {
  kind: "agent",
  key: "review",
  name: "Review",
  optional: false,
  brief: "",
  session: "fresh",
  budget: 1000,
  place: { column: 0, row: 0 },
};
const implement: Stage = {
  kind: "gate",
  key: "implement",
  name: "Implement",
  optional: false,
  place: { column: 1, row: 0 },
  routes: [{ to: null, condition: null, limit: null }],
};
const otherwise: Route = { to: null, condition: null, limit: null };
const choosing = (words: string): Route => ({
  to: "implement",
  condition: choiceCondition(words),
  limit: 3,
});

function changeOf(from: readonly Route[], to: readonly Route[]): ProposedStageRoutes {
  return { stageKey: "review", stageName: "Review", from: [...from], to: [...to] };
}

describe("a Proposal of an Agent's choices", () => {
  const change = changeOf(
    [choosing("the review found something"), otherwise],
    [choosing("the review found something to fix"), otherwise],
  );
  const stages = [{ ...review, routes: change.to }, implement];

  it("counts new words for a choice as a change, drawing the old row dotted and the new dashed", () => {
    const routes: ProposedRoutes = { stages: [change], check: [] };
    const { stages: shown, overlay } = proposalFlow(stages, routes);

    expect(shown[0]?.routes).toEqual([otherwise]);
    expect(overlay.proposed.get("review")).toEqual([choosing("the review found something to fix")]);
    expect(overlay.takenAway.get("review")).toEqual([choosing("the review found something")]);
  });

  it("shows a choice's words as they were and as proposed", () => {
    const was = sourceOf(change, "from");
    const proposed = sourceOf(change, "to");

    expect(routeWhenAfterTarget(change.from[0]!, was, stages, 0)).toBe(
      " if the Agent chooses: the review found something",
    );
    expect(routeWhenAfterTarget(change.to[0]!, proposed, stages, 0)).toBe(
      " if the Agent chooses: the review found something to fix",
    );
    expect(routesOutSentence(change, stages)).toBe(
      "Routes out of Review: to Implement if the Agent chooses: the review found something to fix, at most 3 times, otherwise to End.",
    );
  });
});
