import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import type { ProbeSession } from "../../probe-session.ts";
import { SESSION_PLUGIN_NAME, writeProjectCommand, writeProjectSkill } from "../../sandbox.ts";
import { skill } from "./fixtures.ts";
import { listedSkillNames } from "./skill-observations.ts";

/** A Project skill whose frontmatter names it otherwise than its folder. */
const RENAMED = { folder: "deploy-folder", name: "deploy-named" } as const;
const ROOT_SKILL = "lint";
const ROOT_COMMAND = "ship";
const NESTED_COMMAND = { folder: "frontend", name: "notes" } as const;
const NESTED_SKILL = { folder: "apps/web", name: "release" } as const;

/** Every name a Project skill or command here could be listed by. */
const CANDIDATE_NAMES = [
  RENAMED.folder,
  RENAMED.name,
  ROOT_SKILL,
  ROOT_COMMAND,
  NESTED_COMMAND.name,
  `${NESTED_COMMAND.folder}:${NESTED_COMMAND.name}`,
  NESTED_SKILL.name,
];

/**
 * By which names the engine lists a Project's skills and commands at a session's start, so The
 * Office expects, allows and turns off the right ones (spec §5.6). No model call.
 */
export const projectNamesCheck: Check = {
  id: "skills.project-names",
  title: "the names Project skills and commands are listed by: renamed, nested, under an allowlist",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    await mkdir(join(repository, ".claude", "skills", RENAMED.folder), { recursive: true });
    await writeFile(
      join(repository, ".claude", "skills", RENAMED.folder, "SKILL.md"),
      `---\nname: ${RENAMED.name}\ndescription: The renamed skill.\n---\n\nReply with the word renamed.\n`,
    );
    await writeProjectSkill(repository, skill(ROOT_SKILL));
    await writeProjectSkill(repository, skill(NESTED_SKILL.name), NESTED_SKILL.folder);
    await writeProjectCommand(repository, {
      name: ROOT_COMMAND,
      description: "The ship command.",
      body: "Reply with the word ship.",
    });
    const nestedCommand = join(repository, ".claude", "commands", NESTED_COMMAND.folder);
    await mkdir(nestedCommand, { recursive: true });
    await writeFile(
      join(nestedCommand, `${NESTED_COMMAND.name}.md`),
      "---\ndescription: The nested command.\n---\n\nReply with the word notes.\n",
    );
    const listedUnder = async (spec: {
      allowedSkills?: readonly string[];
      skillOverrides?: Record<string, "off">;
    }): Promise<string[]> => {
      const session = await startSession({
        repository,
        ...(spec.allowedSkills === undefined
          ? { options: { skills: "all" } }
          : { allowedSkills: spec.allowedSkills }),
        ...(spec.skillOverrides && { settings: { skillOverrides: spec.skillOverrides } }),
      });
      return projectNames(session);
    };
    return {
      listedWithAll: await listedUnder({}),
      listedUnderBareNames: await listedUnder({
        allowedSkills: [RENAMED.name, ROOT_SKILL, ROOT_COMMAND, NESTED_COMMAND.name],
      }),
      listedUnderFolderNames: await listedUnder({
        allowedSkills: [RENAMED.folder, NESTED_COMMAND.folder],
      }),
      listedWithFolderNamesOff: await listedUnder({
        skillOverrides: { [RENAMED.folder]: "off", [NESTED_COMMAND.name]: "off" },
      }),
      listedWithListedNamesOff: await listedUnder({
        skillOverrides: {
          [RENAMED.name]: "off",
          [`${NESTED_COMMAND.folder}:${NESTED_COMMAND.name}`]: "off",
        },
      }),
    };
  },
};

/** The listing before any message, which `skills.start-before-brief` shows is the start's. */
async function projectNames(session: ProbeSession): Promise<string[]> {
  await session.control.initializationResult();
  return (await listedSkillNames(session)).filter(
    (name) =>
      !name.startsWith(`${SESSION_PLUGIN_NAME}:`) &&
      CANDIDATE_NAMES.some((candidate) => name === candidate || name.endsWith(`:${candidate}`)),
  );
}
