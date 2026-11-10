import { describe, expect, it } from "vitest";
import { calledSkill } from "./skill-calls.js";

describe("calledSkill", () => {
  it("gives the skill a Skill call names, without a leading /", () => {
    expect(calledSkill("Skill", { skill: "office:tdd", args: "now" })).toBe("office:tdd");
    expect(calledSkill("Skill", { skill: "/ops:deploy" })).toBe("ops:deploy");
  });

  it("gives none for another tool or a call naming no skill", () => {
    expect(calledSkill("Read", { skill: "tdd" })).toBeUndefined();
    expect(calledSkill("Skill", { name: "tdd" })).toBeUndefined();
    expect(calledSkill("Skill", { skill: "/" })).toBeUndefined();
    expect(calledSkill("Skill", null)).toBeUndefined();
  });
});
