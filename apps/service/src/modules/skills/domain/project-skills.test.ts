import { describe, expect, it } from "vitest";
import { projectSkillsFrom } from "./project-skills.js";

const file = (path: string, text = "") => ({ path, text });

describe("projectSkillsFrom", () => {
  it("lists the repository's skills and commands by path, as a session names them", () => {
    expect(
      projectSkillsFrom(
        [
          file(
            ".claude/skills/deploy/SKILL.md",
            "---\nname: deploy\ndescription: Deploys it.\n---\n",
          ),
          file(".claude/commands/ship.md", "---\ndescription: Ships it.\n---\nShip."),
          file("apps/web/.claude/skills/release/SKILL.md", "No frontmatter."),
          file("README.md", "Not a skill."),
        ],
        new Set(["deploy"]),
      ),
    ).toEqual([
      {
        name: "ship",
        description: "Ships it.",
        path: ".claude/commands/ship.md",
        listedAtStart: true,
        alsoInLibrary: false,
      },
      {
        name: "deploy",
        description: "Deploys it.",
        path: ".claude/skills/deploy",
        listedAtStart: true,
        alsoInLibrary: true,
      },
      {
        name: "release",
        description: "",
        path: "apps/web/.claude/skills/release",
        listedAtStart: false,
        alsoInLibrary: false,
      },
    ]);
  });
});
