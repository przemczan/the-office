import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import type { ProbeSession } from "../../probe-session.ts";
import { writeProjectCommand, writeProjectSkill } from "../../sandbox.ts";
import { toolCalls } from "../tool-calls.ts";
import { skill } from "./fixtures.ts";
import { listedSkillNames, namesSkill, userInvocableNames } from "./skill-observations.ts";

const NESTED_FOLDER = "apps/web";
const NESTED_FILE = `${NESTED_FOLDER}/notes.txt`;

/** Each level has one name turned off and one left on, so a name missing for any other reason shows. */
const ROOT_SKILLS = { off: "deploy", on: "lint" } as const;
const NESTED_SKILLS = {
  offByNestedName: "release",
  offByBareName: "migrate",
  on: "audit",
} as const;
const COMMANDS = { off: "ship", on: "notes" } as const;
const PROJECT_NAMES = [
  ...Object.values(ROOT_SKILLS),
  ...Object.values(NESTED_SKILLS),
  ...Object.values(COMMANDS),
];

const SKILL_OVERRIDES = {
  [ROOT_SKILLS.off]: "off",
  [`${NESTED_FOLDER}:${NESTED_SKILLS.offByNestedName}`]: "off",
  [NESTED_SKILLS.offByBareName]: "off",
  [COMMANDS.off]: "off",
} as const;

/** Whether `skillOverrides: "off"` keys reach nested Project skills and `.claude/commands` files (spec §5.6). */
export const overridesOffCheck: Check = {
  id: "skills.overrides-off",
  title: "skillOverrides off against root and nested Project skills and .claude/commands files",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    await writeProjectSkill(repository, skill(ROOT_SKILLS.off));
    await writeProjectSkill(repository, skill(ROOT_SKILLS.on));
    for (const name of Object.values(NESTED_SKILLS)) {
      await writeProjectSkill(repository, skill(name), NESTED_FOLDER);
    }
    for (const name of Object.values(COMMANDS)) {
      await writeProjectCommand(repository, {
        name,
        description: `The ${name} command.`,
        body: `Reply with the word ${name}.`,
      });
    }
    await writeFile(join(repository, NESTED_FILE), "Nested notes.\n");
    const session = await startSession({
      repository,
      // Every Project name is allowed, so only the overrides can hide one.
      allowedSkills: PROJECT_NAMES,
      settings: { skillOverrides: SKILL_OVERRIDES },
    });
    await session.initWithoutTurn();
    const atStart = await projectSkillsSeen(session);
    // Nested Project skills load only once a file below them is touched.
    session.send(`Use the Read tool to read ${NESTED_FILE}, then reply with just OK.`);
    await session.nextResult();
    const nestedFileRead = toolCalls(session.messages).some(
      (call) =>
        call.name === "Read" &&
        call.outcome === "allowed" &&
        String(call.input["file_path"]).replaceAll("\\", "/").endsWith(NESTED_FILE),
    );
    return { atStart, nestedFileRead, afterNestedFileRead: await projectSkillsSeen(session) };
  },
};

function isProjectName(name: string): boolean {
  return PROJECT_NAMES.some((projectName) => namesSkill(name, projectName));
}

async function projectSkillsSeen(
  session: ProbeSession,
): Promise<{ listed: string[]; userInvocable: string[] }> {
  return {
    listed: (await listedSkillNames(session)).filter(isProjectName),
    userInvocable: (await userInvocableNames(session)).filter(isProjectName),
  };
}
