import { expect, it } from "vitest";
import { inGridOrder } from "./people-order.ts";

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
