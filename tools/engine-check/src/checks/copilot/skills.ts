import { join } from "node:path";
import type { Check } from "../../check.ts";
import type { CopilotSession } from "../../copilot-cli/copilot-session.ts";
import { eventsOfType } from "../../copilot-cli/events.ts";
import { writeSkill, type SkillFixture } from "../../sandbox.ts";
import { sortedNames } from "../observations.ts";
import { answerHolds } from "./helpers.ts";

function skill(name: string, body = "Follow the engine check's instructions."): SkillFixture {
  return { name, description: `The engine check's ${name}.`, body };
}

/** Each skill the session lists as `name:source`, sorted. */
async function listedSkills(session: CopilotSession): Promise<string[]> {
  const { skills } = await session.sdk.rpc.skills.list();
  return sortedNames(skills.map((each) => `${each.name}:${each.source}`));
}

/**
 * Skills on the Copilot engine: whether the lean options load only the skill folders the Office
 * names (`skills.directories`), against the repository's `.github/skills` and `.claude/skills` and
 * the config folder's `skills/`, which discovery turns on; and whether any load with skills off.
 */
export const copilotSkillsCheck: Check = {
  id: "copilot.skills",
  title:
    "the lean options load only the named skill folders; discovery adds the repository's and the user's",
  async run({ sandbox, copilotHome, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    const folder = join(sandbox.officeData, "skills");
    await writeSkill(join(folder, "given-skill"), skill("given-skill"));
    await writeSkill(
      join(repository, ".github", "skills", "project-skill"),
      skill("project-skill"),
    );
    await writeSkill(join(repository, ".claude", "skills", "claude-skill"), skill("claude-skill"));
    await writeSkill(join(copilotHome, "skills", "user-skill"), skill("user-skill"));
    const lean = await startCopilotSession({ repository, skills: { directories: [folder] } });
    const discovering = await startCopilotSession({
      repository,
      skills: { directories: [folder] },
      configDiscovery: true,
    });
    const off = await startCopilotSession({ repository });
    const offSkills = (await off.sdk.rpc.skills.list()).skills;
    return {
      lean: await listedSkills(lean),
      discovery: await listedSkills(discovering),
      skillsOff: {
        listed: sortedNames(offSkills.map((each) => each.name)),
        anyEnabled: offSkills.some((each) => each.enabled),
      },
    };
  },
};

const SKILL_NAME = "code-word";
const SKILL_WORD = "ZEPHYR";

/**
 * A skill as a command: the Office's skill, from a folder it names, is run by sending
 * `/<skill name>`, the runtime reports it with `skill.invoked`, and the model follows its body.
 */
export const copilotSkillCommandCheck: Check = {
  id: "copilot.skill-command",
  title: "sending /<skill name> invokes a skill from the named folder, and the model follows it",
  async run({ sandbox, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    const folder = join(sandbox.officeData, "skills");
    await writeSkill(
      join(folder, SKILL_NAME),
      skill(SKILL_NAME, `Reply with exactly the word ${SKILL_WORD} and nothing else.`),
    );
    const session = await startCopilotSession({ repository, skills: { directories: [folder] } });
    const listed = (await session.sdk.rpc.skills.list()).skills.find(
      (each) => each.name === SKILL_NAME,
    );
    const events = await session.turn(`/${SKILL_NAME}`);
    return {
      listed: listed !== undefined,
      userInvocable: listed?.userInvocable ?? null,
      commandName: listed?.commandName ?? null,
      invokedSkills: sortedNames(
        eventsOfType(events, "skill.invoked").map((event) => event.data.name),
      ),
      answerHoldsWord: answerHolds(events, SKILL_WORD),
    };
  },
};
