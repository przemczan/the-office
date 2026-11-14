import { describe, expect, it } from "vitest";
import { hiredKeyOf, hireWords, setUpProblems, type SetUpHire } from "./office-setup.js";
import { aRoleCard } from "./role.fixtures.js";

const jan: SetUpHire = { kind: "hire-from-preset", roleKey: "planner", name: "Jan" };
const max: SetUpHire = {
  kind: "hire",
  card: aRoleCard({ name: "Max", title: "Data Analyst" }),
  skills: [],
};

describe("hiredKeyOf", () => {
  it("keys a preset's hire by the preset and a hire from scratch by its title", () => {
    expect(hiredKeyOf(jan)).toBe("planner");
    expect(hiredKeyOf(max)).toBe("data-analyst");
  });
});

describe("hireWords", () => {
  it("names the person with the Role's title", () => {
    expect(hireWords(jan)).toBe("Jan · Planner");
    expect(hireWords(max)).toBe("Max · Data Analyst");
  });
});

describe("setUpProblems", () => {
  it("passes hires and duties that each change something", () => {
    expect(
      setUpProblems([jan, max], [{ duty: "plans", from: "planner", to: "data-analyst" }], {}),
    ).toEqual([]);
  });

  it("refuses a set-up of nothing", () => {
    expect(setUpProblems([], [], {})).toEqual([
      "Nothing to set up: give the people to hire, the duties to assign, or both.",
    ]);
  });

  it("refuses two hires into the same Role", () => {
    const ola: SetUpHire = { kind: "hire-from-preset", roleKey: "planner", name: "Ola" };

    expect(setUpProblems([jan, ola, max], [], {})).toEqual([
      'Jan · Planner and Ola · Planner would fill the same Role "planner"; hire one person into it.',
    ]);
  });

  it("refuses a duty that goes to its Role already, set or by default", () => {
    expect(
      setUpProblems(
        [jan],
        [
          { duty: "plans", from: "planner", to: "planner" },
          { duty: "reviews", from: null, to: null },
        ],
        { reviews: null },
      ),
    ).toEqual([
      'Plans goes to "planner" already; leave it out.',
      'Reviews goes to "nobody" already; leave it out.',
    ]);
  });
});
