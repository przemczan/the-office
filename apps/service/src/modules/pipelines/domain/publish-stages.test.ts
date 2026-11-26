import { describe, expect, it } from "vitest";
import { asFlow, type FlowStage } from "./flow.js";
import {
  ENDED_CONFLICT,
  RESOLVE_GATE_KEY,
  RESOLVE_KEY,
  RESOLVE_TEST_KEY,
} from "./publish-stages.js";
import { RESOLVE_TEMPLATE_BRIEF, RESOLVE_TEMPLATE_ID } from "./resolve-template.js";
import { ENDED_FAILED, plainRoute } from "./route.js";
import {
  agentStage,
  dutyStage,
  goingBackOnFailure,
  keptPublishStage,
  publishStage,
  scriptStage,
} from "./stage.fixtures.js";

const implement = agentStage({ budget: 200_000 });
const review = agentStage({ key: "review", name: "Review & fix", budget: 370_000 });
const tests = scriptStage();

/** The Stage `key` of `flow`. */
function stageOf(flow: readonly FlowStage[], key: string): FlowStage {
  const stage = flow.find((one) => one.key === key);
  if (!stage) throw new Error(`No Stage ${key}.`);
  return stage;
}

describe("withPublishStages, read through asFlow", () => {
  it("reads a kept Script publish Stage as a Publish Stage, keeping its key, name, target and routes", () => {
    const flow = asFlow([implement, keptPublishStage({ publishTarget: "branch-only" })]);

    expect(stageOf(flow, "publish")).toEqual({
      kind: "publish",
      key: "publish",
      name: "Publish",
      optional: false,
      publishTarget: "branch-only",
      routes: [plainRoute(null)],
      position: { x: 308, y: 0 },
    });
    expect(flow).toHaveLength(2);
  });

  it("draws the conflict chain for a Publish by the publishing mode, on a row under it, in the old grid's order", () => {
    const flow = asFlow([
      implement,
      tests,
      review,
      goingBackOnFailure(keptPublishStage(), "review", 1),
    ]);

    expect(flow.map(({ key }) => key)).toEqual([
      "implement",
      "tests",
      RESOLVE_KEY,
      "review",
      RESOLVE_TEST_KEY,
      "publish",
    ]);
    expect(stageOf(flow, "publish").routes).toEqual([
      { to: "review", toName: "Review & fix", condition: ENDED_FAILED, limit: 1 },
      { to: RESOLVE_KEY, toName: "Resolve", condition: ENDED_CONFLICT, limit: 3 },
      plainRoute(null),
    ]);
    expect(stageOf(flow, RESOLVE_KEY)).toEqual({
      kind: "agent",
      key: RESOLVE_KEY,
      name: "Resolve",
      optional: false,
      role: "developer",
      brief: RESOLVE_TEMPLATE_BRIEF,
      session: "fresh",
      budget: 620_000,
      mergeBaseFirst: true,
      templateId: RESOLVE_TEMPLATE_ID,
      routes: [{ ...plainRoute(RESOLVE_TEST_KEY), toName: "Test after Resolve" }],
      // Row 0 is as tall as Publish, which lists its three routes.
      position: { x: 308, y: 170 },
    });
    expect(stageOf(flow, RESOLVE_TEST_KEY)).toMatchObject({
      kind: "script",
      command: "test",
      routes: [
        { to: RESOLVE_KEY, toName: "Resolve", condition: ENDED_FAILED, limit: 2 },
        { ...plainRoute("publish"), toName: "Publish" },
      ],
      position: { x: 616, y: 170 },
    });
  });

  it("puts the Review Gate after the Test where the Publish asked for a review after a conflict", () => {
    const flow = asFlow([implement, tests, keptPublishStage({ afterConflict: "review" })]);

    expect(stageOf(flow, RESOLVE_TEST_KEY).routes[1]).toMatchObject({ to: RESOLVE_GATE_KEY });
    expect(stageOf(flow, RESOLVE_GATE_KEY)).toMatchObject({
      kind: "gate",
      name: "Review the resolved conflict",
      routes: [{ to: "publish", condition: null }],
    });
    expect(stageOf(flow, "publish")).not.toHaveProperty("afterConflict");
  });

  it("makes new columns before a Publish that has too few", () => {
    const flow = asFlow([implement, keptPublishStage()]);

    expect(flow.map(({ key, position }) => ({ key, position }))).toEqual([
      { key: "implement", position: { x: 0, y: 0 } },
      { key: RESOLVE_KEY, position: { x: 0, y: 148 } },
      { key: RESOLVE_TEST_KEY, position: { x: 308, y: 148 } },
      { key: "publish", position: { x: 616, y: 0 } },
    ]);
  });

  it("draws the chain just before its Publish in a list with positions, each beside the Stage before it", () => {
    const flow = asFlow([
      { ...implement, routes: [plainRoute("publish")], position: { x: 0, y: 0 } },
      { ...keptPublishStage(), routes: [plainRoute(null)], position: { x: 900, y: 0 } },
    ]);

    expect(flow.map(({ key, position }) => ({ key, position }))).toEqual([
      { key: "implement", position: { x: 0, y: 0 } },
      { key: RESOLVE_KEY, position: { x: 308, y: 0 } },
      { key: RESOLVE_TEST_KEY, position: { x: 616, y: 0 } },
      { key: "publish", position: { x: 900, y: 0 } },
    ]);
  });

  it("names the first Agent Stage's duty on Resolve", () => {
    const flow = asFlow([dutyStage("implements"), keptPublishStage()]);

    expect(stageOf(flow, RESOLVE_KEY)).toMatchObject({ duty: "implements" });
    expect(stageOf(flow, RESOLVE_KEY)).not.toHaveProperty("role");
  });

  it("draws no chain in a Pipeline with no Agent Stage, nor for a Publish of the branch only", () => {
    expect(asFlow([tests, keptPublishStage()]).map(({ key }) => key)).toEqual(["tests", "publish"]);
    expect(
      asFlow([implement, keptPublishStage({ publishTarget: "branch-only" })]).map(({ key }) => key),
    ).toEqual(["implement", "publish"]);
  });

  it("gives a second Publish's chain keys of its own", () => {
    const flow = asFlow([implement, keptPublishStage(), keptPublishStage({ key: "ship" })]);

    expect(stageOf(flow, "ship").routes[0]).toMatchObject({ to: `${RESOLVE_KEY}-2` });
    expect(stageOf(flow, `${RESOLVE_TEST_KEY}-2`).routes[1]).toMatchObject({ to: "ship" });
  });

  it("gives a second Publish's Resolve the budget of the Pipeline's own Agent Stages, not the first Resolve's", () => {
    const flow = asFlow([implement, keptPublishStage(), keptPublishStage({ key: "ship" })]);

    expect(stageOf(flow, `${RESOLVE_KEY}-2`)).toMatchObject({ budget: 450_000 });
  });

  it("never draws a chain for a Stage already of the Publish kind, so reading twice changes nothing", () => {
    const once = asFlow([implement, tests, keptPublishStage()]);

    expect(asFlow(once)).toEqual(once);
    expect(asFlow([implement, publishStage()]).map(({ key }) => key)).toEqual([
      "implement",
      "publish",
    ]);
  });
});
