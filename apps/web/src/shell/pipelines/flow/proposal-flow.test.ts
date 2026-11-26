import type { ProposedRoutes, Route, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { choiceCondition } from "./flow-model.ts";
import {
  layoutSentences,
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
  position: { x: 0, y: 0 },
};
const implement: Stage = {
  kind: "gate",
  key: "implement",
  name: "Implement",
  optional: false,
  position: { x: 308, y: 0 },
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

describe("a Proposal's order and positions", () => {
  const tests: Stage = { kind: "gate", key: "tests", name: "Tests", optional: false };
  const was = [review, implement, { ...tests, position: { x: 616, y: 0 } }];

  it("says nothing when it keeps the order and where every Stage stands", () => {
    const added = { ...tests, key: "lint", name: "Lint", position: { x: 924, y: 0 } };
    expect(layoutSentences(was, [...was, added])).toEqual([]);
  });

  it("names the new order, and how many Stages it moves on the canvas", () => {
    const proposed = [
      { ...implement, position: { x: 0, y: 0 } },
      { ...review, position: { x: 308, y: 96 } },
      was[2]!,
    ];
    expect(layoutSentences(was, proposed)).toEqual([
      "It changes the Pipeline's order to Implement, Review, Tests.",
      "It also moves 2 Stages on the canvas, which doesn't change how the Pipeline runs.",
    ]);
  });

  it("counts a Stage it adds among the others as changing the order", () => {
    const lint = { ...tests, key: "lint", name: "Lint" };
    expect(layoutSentences(was, [review, lint, implement, was[2]!])).toEqual([
      "It changes the Pipeline's order to Review, Lint, Implement, Tests.",
    ]);
    const moved = [review, { ...implement, position: { x: 308, y: 40 } }, was[2]!];
    expect(layoutSentences(was, moved)).toEqual([
      "It also moves 1 Stage on the canvas, which doesn't change how the Pipeline runs.",
    ]);
  });
});
