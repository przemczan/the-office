import { join } from "node:path";
import type { Check } from "../../check.ts";
import { writePlugin, writeProjectSkill } from "../../sandbox.ts";
import { skill } from "./fixtures.ts";
import { listedSkillNames } from "./skill-observations.ts";

/**
 * The research read from the 2.1.308 binary that an entry matches a skill named exactly so or ending
 * in `:<entry>`, so a bare Project skill name also enables every plugin skill of that name.
 */
export const allowlistSuffixCheck: Check = {
  id: "skills.allowlist-suffix",
  title:
    "the skills allowlist matches exact names and `:<name>` suffixes, across plugins and Project skills",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    await writeProjectSkill(repository, skill("review"));
    const vendorPlugin = join(sandbox.root, "vendor-plugin");
    await writePlugin(vendorPlugin, "vendor", [skill("review")]);
    const session = await startSession({
      repository,
      skills: ["alpha", "beta", "gamma", "review"].map((name) => skill(name)),
      additionalPlugins: [vendorPlugin],
      // `alpha` by suffix, `pha` a bare substring, `office:beta` exact, `gamma` not listed, `review` bare.
      allowedSkills: ["alpha", "pha", "office:beta", "review"],
    });
    await session.initWithoutTurn();
    return { listedSkills: await listedSkillNames(session) };
  },
};
