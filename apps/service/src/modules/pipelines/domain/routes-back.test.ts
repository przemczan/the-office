import { describe, expect, it } from "vitest";
import { asFlow, straightLineFlow, type GridStage } from "./flow.js";
import { ENDED_FAILED, plainRoute, ROUTE_LIMIT_MAX, type Route } from "./route.js";
import { withRoutesBack, type KeptStage } from "./routes-back.js";
import { agentStage, scriptStage } from "./stage.fixtures.js";

const implement = agentStage();
const tests = scriptStage();

/** The Tests Stage as a previous release kept it: going back to Implement on failure. */
const keptTests: KeptStage = { ...tests, onFailure: { goBackTo: "implement", rounds: 2 } };

/** The failure route back the kept setting reads as. */
const BACK_TO_IMPLEMENT: Route = {
  to: "implement",
  toName: "Implement",
  condition: ENDED_FAILED,
  limit: 2,
};

describe("withRoutesBack", () => {
  it("reads a kept on-failure setting as a failure route back placed first, its rounds the limit, and drops it", () => {
    const [, read] = withRoutesBack(straightLineFlow([implement, keptTests]));

    expect(read).toEqual({
      ...tests,
      routes: [BACK_TO_IMPLEMENT, plainRoute(null)],
      place: { column: 1, row: 0 },
    });
    expect(read).not.toHaveProperty("onFailure");
  });

  it("keeps a Script Stage's own ended-Failed route after the one its setting became", () => {
    const own: Route = { to: null, condition: ENDED_FAILED, limit: null };
    const kept: KeptStage<GridStage> = {
      ...keptTests,
      routes: [own, plainRoute(null)],
      place: { column: 1, row: 0 },
    };

    const [, read] = withRoutesBack([...straightLineFlow([implement]), kept]);

    expect(read?.routes).toEqual([BACK_TO_IMPLEMENT, own, plainRoute(null)]);
  });

  it("reads rounds above the most a route's limit is as that most, as only the old editor capped them", () => {
    const [, read] = withRoutesBack(
      straightLineFlow([
        implement,
        { ...keptTests, onFailure: { goBackTo: "implement", rounds: 12 } },
      ]),
    );

    expect(read?.routes[0]).toEqual({ ...BACK_TO_IMPLEMENT, limit: ROUTE_LIMIT_MAX });
  });

  it("leaves a Stage without a kept setting as it was", () => {
    const flow = straightLineFlow([implement, tests]);

    expect(withRoutesBack(flow)).toEqual(flow);
  });

  it("keeps the Stage's key as the route's only name when it goes back to a Stage the Pipeline doesn't have", () => {
    const [read] = withRoutesBack(
      straightLineFlow([{ ...keptTests, onFailure: { goBackTo: "gone", rounds: 1 } }]),
    );

    expect(read?.routes[0]).toEqual({ to: "gone", condition: ENDED_FAILED, limit: 1 });
  });
});

describe("asFlow of kept Stages", () => {
  it("converts a plain list, then reads its on-failure settings as routes back", () => {
    expect(asFlow([implement, keptTests])).toEqual([
      { ...implement, routes: [plainRoute("tests")], position: { x: 0, y: 0 } },
      { ...tests, routes: [BACK_TO_IMPLEMENT, plainRoute(null)], position: { x: 308, y: 0 } },
    ]);
  });

  it("changes nothing read a second time", () => {
    const once = asFlow([implement, keptTests]);

    expect(asFlow(once)).toEqual(once);
  });

  it("gives a kept route without a limit the default for where it leads", () => {
    // Routes kept before routes had limits carry none.
    const keptRoutes = [
      { ...implement, routes: [{ to: "tests", condition: null }], place: { column: 0, row: 0 } },
      {
        ...keptTests,
        routes: [
          { to: "implement", condition: ENDED_FAILED },
          { to: null, condition: null },
        ],
        place: { column: 1, row: 0 },
      },
    ] as GridStage[];

    expect(asFlow(keptRoutes).map(({ routes }) => routes.map(({ limit }) => limit))).toEqual([
      [null],
      [2, 3, null],
    ]);
  });
});
