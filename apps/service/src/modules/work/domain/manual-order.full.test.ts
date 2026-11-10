import { describe, expect, it } from "vitest";
import { boardOrder, orderAfter, placementBetween } from "./manual-order.js";
import { aTask } from "./work.fixtures.js";

describe("boardOrder", () => {
  it("sorts by priority, then by manual order", () => {
    const tasks = [
      aTask({ id: "low", priority: "low", order: "a0" }),
      aTask({ id: "normal-later", order: "a2" }),
      aTask({ id: "high", priority: "high", order: "a9" }),
      aTask({ id: "normal-first", order: "a1" }),
    ];

    expect(tasks.toSorted(boardOrder).map((task) => task.id)).toEqual([
      "high",
      "normal-first",
      "normal-later",
      "low",
    ]);
  });

  it("compares keys as plain strings, upper case before lower", () => {
    const upper = aTask({ id: "upper", order: "Zz" });
    const lower = aTask({ id: "lower", order: "a0" });

    expect(boardOrder(upper, lower)).toBeLessThan(0);
  });
});

describe("orderAfter", () => {
  it("places a Task after the greatest key, or first when there is none", () => {
    expect(orderAfter(["a5", "Zz", "a1"]) > "a5").toBe(true);
    expect(orderAfter([])).toEqual(expect.any(String));
  });
});

describe("placementBetween", () => {
  const high = aTask({ id: "high", priority: "high", order: "a1" });
  const low = aTask({ id: "low", priority: "low", order: "a2" });

  it("keeps its own priority when that fits between the neighbours", () => {
    expect(
      placementBetween(aTask({ order: "a7" }), { above: high, below: low }, ["a1", "a2"]),
    ).toEqual({
      priority: "normal",
      order: "a7",
    });
  });

  it("goes after the last Task of the priority above it", () => {
    const placement = placementBetween(
      aTask({ priority: "high", order: "a0" }),
      {
        above: high,
        below: aTask({ id: "normal", order: "a3" }),
      },
      ["a1", "a3"],
    );

    expect(placement.priority).toBe("high");
    expect(placement.order > "a1").toBe(true);
  });

  it("takes the lower neighbour's priority when its own is higher than both", () => {
    const placement = placementBetween(
      aTask({ priority: "high", order: "a0" }),
      {
        above: aTask({ id: "normal", order: "a3" }),
        below: low,
      },
      ["a3", "a2"],
    );

    expect(placement.priority).toBe("normal");
    expect(placement.order > "a3").toBe(true);
  });
});
