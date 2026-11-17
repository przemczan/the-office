import { describe, expect, it } from "vitest";
import { straightLineFlow, type FlowStage } from "./flow.js";
import {
  proposedRoutes,
  routeChangesOf,
  routeChangeWords,
  routesWords,
} from "./proposed-routes.js";
import type { Route } from "./route.js";
import { agentStage, gate, scriptStage } from "./stage.fixtures.js";

const implement = agentStage();
const tests = scriptStage();
const review = agentStage({ key: "review", name: "Review" });
const publish = scriptStage({ key: "publish", name: "Publish", command: "publish" });

const before = straightLineFlow([implement, tests, publish]);

const reviewWhenChangedOrFailed: Route[] = [
  {
    to: "review",
    toName: "Review",
    condition: {
      combine: "any",
      tests: [
        { kind: "stage", stage: null, is: "changed" },
        { kind: "stage", stage: "tests", stageName: "Tests", is: "failed" },
      ],
    },
  },
  { to: "publish", toName: "Publish", condition: null },
];

/** `before` with Review after Tests, run only when Tests changed files or ended Failed. */
const after: FlowStage[] = [
  before[0] as FlowStage,
  { ...tests, routes: reviewWhenChangedOrFailed, place: { column: 1, row: 0 } },
  { ...review, routes: [{ to: "publish", condition: null }], place: { column: 2, row: 0 } },
  { ...publish, routes: [{ to: null, condition: null }], place: { column: 3, row: 0 } },
];

describe("routeChangesOf", () => {
  it("lists only the Stages whose routes change, in the proposed order, a new one's as from none", () => {
    expect(routeChangesOf(before, after)).toEqual([
      {
        stageKey: "tests",
        stageName: "Tests",
        from: [{ to: "publish", condition: null }],
        to: reviewWhenChangedOrFailed,
      },
      {
        stageKey: "review",
        stageName: "Review",
        from: [],
        to: [{ to: "publish", condition: null }],
      },
    ]);
  });

  it("lists a removed Stage last, its routes as to none", () => {
    const withoutTests: FlowStage[] = [
      { ...implement, routes: [{ to: "publish", condition: null }], place: { column: 0, row: 0 } },
      before[2] as FlowStage,
    ];

    expect(routeChangesOf(before, withoutTests)).toEqual([
      {
        stageKey: "implement",
        stageName: "Implement",
        from: [{ to: "tests", condition: null }],
        to: [{ to: "publish", condition: null }],
      },
      { stageKey: "tests", stageName: "Tests", from: [{ to: "publish", condition: null }], to: [] },
    ]);
  });

  it("weighs routes as kept: the Stages' names in them don't count, nor a field left undefined", () => {
    const named: FlowStage[] = after.map((stage) => ({
      ...stage,
      routes: stage.routes.map(({ to, condition }) => ({
        to,
        ...(to === null ? {} : { toName: `Renamed ${to}` }),
        condition,
      })),
    }));
    const unnamedTests: Route[] = [
      {
        to: "review",
        condition: {
          combine: "any",
          tests: [
            { kind: "stage", stage: null, is: "changed" },
            { kind: "stage", stage: "tests", stageName: undefined, is: "failed" },
          ],
        },
      },
      { to: "publish", condition: null },
    ];
    const withUnnamedTests = named.map((stage) =>
      stage.key === "tests" ? { ...stage, routes: unnamedTests } : stage,
    );

    expect(routeChangesOf(after, named)).toEqual([]);
    expect(routeChangesOf(after, withUnnamedTests)).toEqual([]);
  });
});

describe("proposedRoutes", () => {
  it("keeps the check's warnings with every field, null where a problem is on no Stage", () => {
    const routes = proposedRoutes(before, after, [
      { level: "warning", text: "Mind it." },
      { stageKey: "review", at: { kind: "route", routeIndex: 0 }, level: "warning", text: "Hm." },
    ]);

    expect(routes.check).toEqual([
      { stageKey: null, at: null, level: "warning", text: "Mind it." },
      { stageKey: "review", at: { kind: "route", routeIndex: 0 }, level: "warning", text: "Hm." },
    ]);
    expect(routes.stages).toEqual(routeChangesOf(before, after));
  });
});

describe("routeChangeWords", () => {
  it("says each change in plain words: as it was and as proposed, a new Stage's and a removed one's", () => {
    const look = gate({ key: "look", name: "Look" });

    expect(
      routeChangeWords([
        ...routeChangesOf(before, after),
        { stageKey: "look", stageName: look.name, from: [{ to: null, condition: null }], to: [] },
      ]),
    ).toEqual([
      "- Tests: was to publish always; now to Review when the previous Stage changed files or Tests ended Failed, otherwise to Publish always.",
      "- Review (new): to publish always.",
      "- Look (removed): was to End always.",
    ]);
  });
});

describe("routesWords", () => {
  it("names every built-in test and nests groups in brackets", () => {
    const routes: Route[] = [
      {
        to: "review",
        toName: "Review",
        condition: {
          combine: "all",
          tests: [
            { kind: "definitionOfDone", is: "some-not-met" },
            {
              combine: "any",
              tests: [
                { kind: "stage", stage: "tests", stageName: "Tests", is: "unchanged" },
                { kind: "stage", stage: "implement", is: "ran", times: 3 },
                { kind: "stage", stage: null, is: "skipped" },
                { kind: "stage", stage: null, is: "done" },
                { kind: "command", key: "lint" },
              ],
            },
          ],
        },
      },
      {
        to: null,
        condition: { combine: "all", tests: [{ kind: "definitionOfDone", is: "all-met" }] },
      },
    ];

    expect(routesWords(routes)).toBe(
      "to Review when some of the Definition of Done is not Reported met and (Tests changed no files or implement ran 3 or more times or the previous Stage was Skipped or the previous Stage ended Done or the command lint exits 0), otherwise to End when the Definition of Done is all Reported met",
    );
  });
});
