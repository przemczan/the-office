import { describe, expect, it } from "vitest";
import { amenitiesOf, layoutOffice } from "./floor-plan.ts";
import { placementsOf } from "./live-states.ts";
import { DAY_LIGHT, officePerson, rosterOf } from "./live-view.fixtures.ts";
import type { Placement } from "./live-view-types.ts";
import { routeFloorOf } from "./routes.ts";
import { createWalkers } from "./walkers.ts";

const NOW = new Date(2026, 10, 15, 13, 5);
const FRAME_SECONDS = 1 / 60;
const FRAMES = 600;
/**
 * A frame's whole budget is 16.7ms. Stepping 30 walkers takes a small part of it on average, and 99
 * steps in 100 stay within a quarter of a frame. The single slowest step isn't bounded: under a
 * parallel test run it measures the scheduler or a GC pause, not the walkers.
 */
const MEAN_STEP_BUDGET_MS = 0.5;
const P99_STEP_BUDGET_MS = 4;

describe("walkers at scale", () => {
  it("steps 30 people crossing the 30-person floor well within a frame", () => {
    const people = rosterOf(30).map((person) => officePerson(person.roleKey, { state: "working" }));
    const layout = layoutOffice(people);
    const amenities = amenitiesOf(layout);
    const walkers = createWalkers(routeFloorOf(layout, amenities));
    const atDesks = placementsOf(people, layout, amenities, DAY_LIGHT, NOW);
    walkers.direct(people, atDesks, { animate: true });
    const desks = people.map((person) => atDesks.get(person.roleKey)!);
    /** Everyone sent to someone else's desk, `shift` along: they all cross the floor at once. */
    const shifted = (shift: number): Map<string, Placement> =>
      new Map(people.map((person, i) => [person.roleKey, desks[(i + shift) % desks.length]!]));

    const took = new Float64Array(FRAMES);
    let moving = 0;
    for (let frame = 0; frame < FRAMES; frame++) {
      // A new snapshot every 200 frames turns everyone mid-walk.
      if (frame % 200 === 0) walkers.direct(people, shifted(7 + frame / 20), { animate: true });
      const started = performance.now();
      moving = Math.max(moving, walkers.step(FRAME_SECONDS).length);
      took[frame] = performance.now() - started;
    }
    const total = took.reduce((sum, ms) => sum + ms, 0);
    const p99 = took.toSorted()[Math.floor(FRAMES * 0.99)]!;
    expect(moving).toBe(30);
    expect(total / FRAMES).toBeLessThan(MEAN_STEP_BUDGET_MS);
    expect(p99).toBeLessThan(P99_STEP_BUDGET_MS);
  });
});
