import { describe, expect, it } from "vitest";
import {
  DUTIES,
  dutiesHeldBy,
  dutyChangeProblems,
  dutyHolding,
  dutyHoldings,
  hiredKeysOf,
  mcpToolDefault,
} from "./duties.js";
import { ASK_ME, consult } from "./hard-switches.js";
import { aRole, aRoleCard } from "./role.fixtures.js";

const EVERY_PRESET = new Set([
  "planner",
  "developer",
  "reviewer",
  "cto",
  "devops",
  "office-manager",
]);
const NOBODY = new Set<string>();

describe("DUTIES", () => {
  it("are spec 2.2's eight, in its order, each with its default Role key and fallback", () => {
    expect(
      DUTIES.map(({ key, defaultRoleKey, fallback }) => [key, defaultRoleKey, fallback]),
    ).toEqual([
      ["default-person-to-talk-to", "office-manager", "caretaker"],
      ["shapes-initiatives", "cto", "user"],
      ["asked-first-when-out-of-tries", "cto", "user"],
      ["onboards-projects", "devops", "user"],
      ["mcp-tool-consultant", "devops", "user"],
      ["plans", "planner", "user"],
      ["implements", "developer", "unstaffed"],
      ["reviews", "reviewer", "unstaffed"],
    ]);
  });
});

describe("dutyHolding", () => {
  it("is held by its default Role key while never set and that Role is hired", () => {
    expect(dutyHolding("plans", {}, EVERY_PRESET)).toEqual({
      duty: "plans",
      label: "Plans",
      defaultRoleKey: "planner",
      set: false,
      roleKey: "planner",
      holder: "planner",
      fallback: null,
    });
  });

  it("is held by nobody while its Role isn't hired, falling back as the duty says", () => {
    expect(dutyHolding("default-person-to-talk-to", {}, NOBODY)).toMatchObject({
      roleKey: "office-manager",
      holder: null,
      fallback: "caretaker",
    });
    expect(dutyHolding("shapes-initiatives", {}, NOBODY).fallback).toBe("user");
    expect(dutyHolding("implements", {}, NOBODY).fallback).toBe("unstaffed");
    expect(dutyHolding("reviews", {}, NOBODY).fallback).toBe("unstaffed");
  });

  it("is held by the Role it was set to, and by nobody when set to none", () => {
    const assignments = { plans: "lead", reviews: null };

    expect(dutyHolding("plans", assignments, new Set(["lead", "planner"]))).toMatchObject({
      set: true,
      roleKey: "lead",
      holder: "lead",
      fallback: null,
    });
    expect(dutyHolding("reviews", assignments, EVERY_PRESET)).toMatchObject({
      set: true,
      roleKey: null,
      holder: null,
      fallback: "unstaffed",
    });
  });

  it("goes unheld when its holder is let go, and is held again once they are hired back", () => {
    const ops = aRole({ key: "ops" });
    const letGo = aRole({ key: "ops", letGoAt: new Date("2026-11-14T08:00:00.000Z") });
    const assignments = { "onboards-projects": "ops" };

    expect(dutyHolding("onboards-projects", assignments, hiredKeysOf([letGo])).holder).toBeNull();
    expect(dutyHolding("onboards-projects", assignments, hiredKeysOf([ops])).holder).toBe("ops");
  });

  it("names Role keys, so a renamed Role keeps its duties", () => {
    const renamed = aRole({ key: "planner", card: aRoleCard({ title: "Lead planner" }) });

    expect(dutyHolding("plans", {}, hiredKeysOf([renamed])).holder).toBe("planner");
  });
});

describe("hiredKeysOf", () => {
  it("leaves out the people let go and the Caretaker", () => {
    const roles = [
      aRole({ key: "developer" }),
      aRole({ key: "ops", letGoAt: new Date("2026-11-14T08:00:00.000Z") }),
      aRole({ key: "caretaker" }),
    ];

    expect([...hiredKeysOf(roles)]).toEqual(["developer"]);
  });
});

describe("dutiesHeldBy", () => {
  it("gives every duty one Role holds, in spec order", () => {
    expect(dutiesHeldBy("cto", {}, EVERY_PRESET)).toEqual([
      "shapes-initiatives",
      "asked-first-when-out-of-tries",
    ]);
    expect(dutiesHeldBy("lead", { plans: "lead", reviews: "lead" }, new Set(["lead"]))).toEqual([
      "plans",
      "reviews",
    ]);
    expect(dutiesHeldBy("cto", {}, NOBODY)).toEqual([]);
  });

  it("agrees with dutyHoldings", () => {
    const held = dutyHoldings({}, EVERY_PRESET).filter((holding) => holding.holder === "devops");

    expect(held.map((holding) => holding.duty)).toEqual(dutiesHeldBy("devops", {}, EVERY_PRESET));
  });
});

describe("dutyChangeProblems", () => {
  const hired = new Set(["lead"]);

  it("lets a duty go to a hired Role, or to none", () => {
    expect(dutyChangeProblems("plans", "lead", hired)).toEqual([]);
    expect(dutyChangeProblems("plans", null, NOBODY)).toEqual([]);
  });

  it("refuses a Role not hired, which a let-go Role is, and the Caretaker", () => {
    const letGo = hiredKeysOf([aRole({ key: "ops", letGoAt: new Date() })]);

    expect(dutyChangeProblems("plans", "planner", hired)).toEqual([
      'Plans goes to a hired Role, and nobody is hired as "planner".',
    ]);
    expect(dutyChangeProblems("onboards-projects", "ops", letGo)).toEqual([
      'Onboards and repairs Projects goes to a hired Role, and nobody is hired as "ops".',
    ]);
    expect(dutyChangeProblems("plans", "caretaker", new Set(["caretaker"]))).toEqual([
      "The Caretaker is built in and holds no duty, so not Plans.",
    ]);
  });

  it("refuses a duty The Office doesn't have", () => {
    expect(dutyChangeProblems("sweeps-floors", null, hired)).toEqual([
      'The Office has no duty "sweeps-floors".',
    ]);
  });
});

describe("mcpToolDefault", () => {
  it("consults the holder of the MCP duty, or asks the user while nobody holds it", () => {
    expect(mcpToolDefault("ops")).toEqual(consult("ops"));
    expect(mcpToolDefault(undefined)).toEqual(ASK_ME);
  });
});
