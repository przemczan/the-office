import type { Check } from "../../check.ts";
import { SESSION_PLUGIN_NAME } from "../../sandbox.ts";
import { toolCalls } from "../tool-calls.ts";
import { skill } from "./fixtures.ts";
import { listedSkillNames, userInvocableNames } from "./skill-observations.ts";

const DENIED_SKILL = `${SESSION_PLUGIN_NAME}:beta`;

/**
 * Only `skillOverrides: "off"` and `disable-model-invocation` are documented to hide a skill; a deny
 * rule may only block it. The invocation shows the rule is in force, so a listed skill is not a rule that never applied.
 */
export const denyRuleCheck: Check = {
  id: "skills.deny-rule",
  title: "whether a Skill(name) deny rule removes the skill from the listing",
  async run({ sandbox, startSession }) {
    const session = await startSession({
      repository: await sandbox.createRepository(),
      skills: [skill("alpha"), skill("beta")],
      settings: { permissions: { deny: [`Skill(${DENIED_SKILL})`] } },
    });
    await session.initWithoutTurn();
    const listedSkills = await listedSkillNames(session);
    const userInvocable = (await userInvocableNames(session)).filter((name) => name.startsWith(`${SESSION_PLUGIN_NAME}:`));
    session.send(`Use the Skill tool to run the ${DENIED_SKILL} skill, then reply with just OK.`);
    await session.nextResult();
    const invocations = toolCalls(session.messages).filter((call) => call.name === "Skill" && call.input["skill"] === DENIED_SKILL);
    return { listedSkills, userInvocable, deniedSkillInvocation: invocations.at(-1)?.outcome ?? "not attempted" };
  },
};
