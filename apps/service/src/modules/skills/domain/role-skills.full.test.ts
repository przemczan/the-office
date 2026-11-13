import { describe, expect, it } from "vitest";
import {
  assignedSkillsProblems,
  assignmentsChange,
  rolesOfSkill,
  skillsOfRole,
  withRoleSkills,
  withSkillRoles,
  type RoleSkillAssignment,
} from "./role-skills.js";
import { aSkill } from "./skill.fixtures.js";
import { ANN_LEE } from "./user.fixtures.js";

const at = new Date("2026-10-25T10:00:00.000Z");
const assignments: RoleSkillAssignment[] = [
  { roleKey: "developer", skillName: "tdd" },
  { roleKey: "developer", skillName: "debugging" },
  { roleKey: "planner", skillName: "grilling" },
];

describe("withRoleSkills", () => {
  it("replaces only that Role's skills, each once", () => {
    const after = withRoleSkills(assignments, "developer", ["tdd", "refactoring", "tdd"]);

    expect(skillsOfRole(after, "developer")).toEqual(["refactoring", "tdd"]);
    expect(skillsOfRole(after, "planner")).toEqual(["grilling"]);
  });
});

describe("withSkillRoles", () => {
  it("replaces only the Roles that have that skill", () => {
    const after = withSkillRoles(assignments, "tdd", ["reviewer", "planner"]);

    expect(rolesOfSkill(after, "tdd")).toEqual(["planner", "reviewer"]);
    expect(skillsOfRole(after, "developer")).toEqual(["debugging"]);
  });
});

describe("assignmentsChange", () => {
  it("names what each Role gained and lost, in key and name order", () => {
    const after = withSkillRoles(
      withRoleSkills(assignments, "developer", ["tdd", "refactoring"]),
      "grilling",
      ["reviewer"],
    );

    expect(assignmentsChange(assignments, after, at, ANN_LEE)).toEqual({
      assignments: after,
      changes: [
        {
          roleKey: "developer",
          added: ["refactoring"],
          removed: ["debugging"],
          changedAt: at,
          changedBy: ANN_LEE,
        },
        { roleKey: "planner", added: [], removed: ["grilling"], changedAt: at, changedBy: ANN_LEE },
        {
          roleKey: "reviewer",
          added: ["grilling"],
          removed: [],
          changedAt: at,
          changedBy: ANN_LEE,
        },
      ],
    });
  });

  it("names no change when the Roles keep their skills", () => {
    const after = withRoleSkills(assignments, "developer", ["debugging", "tdd"]);

    expect(assignmentsChange(assignments, after, at, ANN_LEE).changes).toEqual([]);
  });
});

describe("assignedSkillsProblems", () => {
  it("refuses each skill the library lacks, once", () => {
    const library = [aSkill({ name: "tdd" })];

    expect(assignedSkillsProblems(["tdd", "ghost", "ghost"], library)).toEqual([
      "The library has no skill ghost.",
    ]);
  });
});
