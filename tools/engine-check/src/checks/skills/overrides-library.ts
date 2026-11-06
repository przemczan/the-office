import type { Check } from "../../check.ts";
import type { ProbeSession } from "../../probe-session.ts";
import { SESSION_PLUGIN_NAME, writeProjectSkill } from "../../sandbox.ts";
import { skill } from "./fixtures.ts";
import { listedSkillNames, namesSkill, userInvocableNames } from "./skill-observations.ts";

/** The name the Project and the library share, and a Project skill left on beside it. */
const SHARED_NAME = "review";
const PROJECT_SKILL_ON = "lint";
const LIBRARY_SKILL = `${SESSION_PLUGIN_NAME}:${SHARED_NAME}`;

/**
 * Whether turning a Project skill off by its bare key also hides the library's skill of that name,
 * which the session must list or the start check refuses it (spec §5.6). No model call.
 */
export const overridesLibraryCheck: Check = {
  id: "skills.overrides-library",
  title: "skillOverrides off for a Project skill against the library's skill of the same name",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    await writeProjectSkill(repository, skill(SHARED_NAME));
    await writeProjectSkill(repository, skill(PROJECT_SKILL_ON));
    const session = await startSession({
      repository,
      skills: [skill(SHARED_NAME)],
      // As The Office starts a session with the Project's copy off: the allowlist leaves it out.
      allowedSkills: [LIBRARY_SKILL, PROJECT_SKILL_ON],
      settings: { skillOverrides: { [SHARED_NAME]: "off" } },
    });
    await session.control.initializationResult();
    return skillsSeen(session);
  },
};

function isChecked(name: string): boolean {
  return namesSkill(name, SHARED_NAME) || name === PROJECT_SKILL_ON;
}

async function skillsSeen(
  session: ProbeSession,
): Promise<{ listed: string[]; userInvocable: string[] }> {
  return {
    listed: (await listedSkillNames(session)).filter(isChecked),
    userInvocable: (await userInvocableNames(session)).filter(isChecked),
  };
}
