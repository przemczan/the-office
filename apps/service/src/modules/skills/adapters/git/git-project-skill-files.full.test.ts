import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../../platform/git-identity/office-identity.fixtures.js";
import { GitProjectSkillFiles } from "./git-project-skill-files.js";
import {
  createProjectCheckout,
  projectSkillMd,
  type ProjectCheckout,
} from "./project-checkout.fixtures.js";

let checkout: ProjectCheckout;
const files = new GitProjectSkillFiles(officeIdentityForTests());

beforeEach(async () => {
  checkout = await createProjectCheckout();
});

afterEach(async () => {
  await checkout.remove();
});

describe("GitProjectSkillFiles", () => {
  it("finds the skills and commands git tracks or would, at any depth", async () => {
    await checkout.write(".claude/skills/deploy/SKILL.md", projectSkillMd("deploy", "Deploys."));
    await checkout.write(".claude/skills/deploy/notes.md", "");
    await checkout.write(".claude/commands/ship.md", "Ship it.");
    await checkout.write("README.md", "");
    checkout.commit();
    await checkout.write(
      "apps/web/.claude/skills/release/SKILL.md",
      projectSkillMd("release", "R."),
    );

    expect((await files.files(checkout.path)).map((file) => file.path).toSorted()).toEqual([
      ".claude/commands/ship.md",
      ".claude/skills/deploy/SKILL.md",
      "apps/web/.claude/skills/release/SKILL.md",
    ]);
  });

  it("reads each file's text", async () => {
    await checkout.write(".claude/skills/deploy/SKILL.md", projectSkillMd("deploy", "Deploys."));

    await expect(files.files(checkout.path)).resolves.toEqual([
      { path: ".claude/skills/deploy/SKILL.md", text: projectSkillMd("deploy", "Deploys.") },
    ]);
  });

  it("leaves out what the repository ignores", async () => {
    await checkout.write(".gitignore", "node_modules/\n");
    await checkout.write("node_modules/x/.claude/skills/x/SKILL.md", projectSkillMd("x", "X."));

    await expect(files.files(checkout.path)).resolves.toEqual([]);
  });
});
