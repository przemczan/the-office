import { describe, expect, it } from "vitest";
import { inGridOrder, isNobodyHired } from "./people-order.ts";

it("pins the built-in Caretaker first and keeps everyone else in the order listed", () => {
  const roles = [
    { key: "cto", builtIn: false },
    { key: "developer", builtIn: false },
    { key: "caretaker", builtIn: true },
    { key: "planner", builtIn: false },
  ];

  expect(inGridOrder(roles).map(({ key }) => key)).toEqual([
    "caretaker",
    "cto",
    "developer",
    "planner",
  ]);
});

describe("isNobodyHired", () => {
  const caretaker = { builtIn: true, letGoAt: null };

  it("holds while only the Caretaker is there, or everyone else was let go", () => {
    expect(isNobodyHired([caretaker])).toBe(true);
    expect(
      isNobodyHired([caretaker, { builtIn: false, letGoAt: "2026-11-14T09:00:00.000Z" }]),
    ).toBe(true);
  });

  it("ends once someone is hired", () => {
    expect(isNobodyHired([caretaker, { builtIn: false, letGoAt: null }])).toBe(false);
  });
});
