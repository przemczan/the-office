import type { Check, CheckContext } from "../../check.ts";
import { SESSION_PLUGIN_NAME } from "../../sandbox.ts";
import { lastOutcome, toolCalls } from "../tool-calls.ts";

const SKILL = "probe";
/** Its output, `git version 2.…`, is not in the command, so seeing it means the command ran. */
const COMMAND = "git --version";
const RAN = /git version \d/;
const PLACEHOLDER = "[shell command execution disabled by policy]";

/**
 * What `disableSkillShellExecution` (spec §5.6) does to a skill whose text runs a command as it
 * loads, and whether the `PreToolUse` hook sees that command when it runs: once with the
 * Office's options, once with the setting off.
 */
export const shellExecutionCheck: Check = {
  id: "skills.shell-execution",
  title: "a skill's !`command` with disableSkillShellExecution, and without it",
  async run(context) {
    return {
      officeOptions: await invokeSkill(context, true),
      settingOff: await invokeSkill(context, false),
    };
  },
};

async function invokeSkill(
  { sandbox, startSession }: CheckContext,
  disableSkillShellExecution: boolean,
): Promise<Record<string, boolean | string>> {
  const session = await startSession({
    repository: await sandbox.createRepository(
      disableSkillShellExecution ? "office-options" : "setting-off",
    ),
    skills: [
      {
        name: SKILL,
        description: "The probe skill.",
        body: `The repository's git is !\`${COMMAND}\`.\n\nReply with the word ${SKILL}.`,
      },
    ],
    settings: { disableSkillShellExecution },
  });
  session.send(
    `Use the Skill tool to run the ${SESSION_PLUGIN_NAME}:${SKILL} skill, then reply with just OK.`,
  );
  await session.nextResult();
  const seen = JSON.stringify(session.messages);
  const invocations = toolCalls(session.messages).filter((call) => call.name === "Skill");
  return {
    skillInvocation: lastOutcome(invocations),
    commandRan: RAN.test(seen),
    placeholderSeen: seen.includes(PLACEHOLDER),
    hookSawCommand: session.hookCalls.some((call) => JSON.stringify(call.input).includes(COMMAND)),
  };
}
