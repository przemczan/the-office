import type { Check } from "../../check.ts";
import { readTranscript, skillListings } from "../../transcripts.ts";
import { skill } from "./fixtures.ts";
import { listedSkillNames } from "./skill-observations.ts";

/**
 * How a resumed session meets a changed skill set: the Office rebuilds the plugin folder and passes
 * the new allowlist (spec §5.6). The transcript shows which listings the engine attached for the model.
 */
export const resumeCheck: Check = {
  id: "skills.resume",
  title: "a changed skill set on resume: the listing is re-read or kept from the first start",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const first = await startSession({ repository, skills: [skill("alpha"), skill("beta")] });
    await first.initWithoutTurn();
    const listedAtStart = await listedSkillNames(first);
    await first.close();
    const resumed = await startSession({ repository, skills: [skill("beta"), skill("gamma")], resume: first.sessionId });
    await resumed.initWithoutTurn();
    const listedAfterResume = await listedSkillNames(resumed);
    await resumed.close();
    return {
      listedAtStart,
      listedAfterResume,
      listingsAttachedForModel: skillListings(await readTranscript(repository, first.sessionId)).map((names) => names.sort()),
    };
  },
};
