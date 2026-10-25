import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Check, Observation } from "../../check.ts";
import type { ProbeSession, SessionSpec } from "../../probe-session.ts";
import { skill } from "../skills/fixtures.ts";
import { callsOn, lastOutcome, toolCalls, type AttemptOutcome } from "../tool-calls.ts";

const MARKER = "fence-marker";
const FILE_TOOLS = ["Read", "Grep", "Glob"] as const;

/** Each tried in its own session: the Office's options, which grant the session's skills folder (spec §5.6), and the same without that grant. */
const GRANTS: Readonly<Record<string, Partial<SessionSpec>>> = {
  withoutGrant: { settings: { permissions: { additionalDirectories: [] } } },
  officeOptions: {},
};

/** A place a file tool is pointed at: a file for Read, its folder for Grep and Glob. */
interface Place {
  readonly file: string;
  readonly folder: string;
}

/**
 * `blockReadsOutsideWorkingDirectories` covers Read, Grep and Glob (spec §6: the file tools are fenced
 * to the worktree and the session's folders); step 3 tried Read alone. A shell read of the same file
 * shows whether the shell is left outside the fence, as the spec's threat model accepts.
 */
export const fileToolFenceCheck: Check = {
  id: "permissions.file-tool-fence",
  title:
    "blockReadsOutsideWorkingDirectories fences Read, Grep and Glob to the worktree and the session's folders",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const officeData: Place = {
      folder: join(sandbox.officeData, "elsewhere"),
      file: join(sandbox.officeData, "elsewhere", "elsewhere.txt"),
    };
    const worktree: Place = { folder: repository, file: join(repository, "inside.txt") };
    await mkdir(officeData.folder, { recursive: true });
    await writeFile(officeData.file, `${MARKER}\n`);
    await writeFile(worktree.file, `${MARKER}\n`);
    const [fileTools, shellReadOfOfficeData] = await Promise.all([
      Promise.all(
        Object.entries(GRANTS).map(async ([grant, spec]) => {
          const session = await startSession({
            repository,
            skills: [skill("notes", { "reference.md": `${MARKER}\n` })],
            ...spec,
          });
          const skillFolder = join(session.pluginFolder, "skills", "notes");
          const sessionSkillsFolder: Place = {
            folder: skillFolder,
            file: join(skillFolder, "reference.md"),
          };
          return [
            grant,
            await tryFileTools(session, { worktree, sessionSkillsFolder, officeData }),
          ] as const;
        }),
      ),
      startSession({ repository }).then((session) => tryShellRead(session, officeData.file)),
    ]);
    return { fileTools: Object.fromEntries(fileTools), shellReadOfOfficeData };
  },
};

async function tryFileTools(
  session: ProbeSession,
  places: Readonly<Record<string, Place>>,
): Promise<Observation> {
  const list = Object.values(places);
  const steps = [
    ...list.map((place) => `Read ${place.file}`),
    ...list.map((place) => `Grep with pattern ${MARKER} and path ${place.folder}`),
    ...list.map((place) => `Glob with pattern * and path ${place.folder}`),
  ];
  session.send(
    "Make these tool calls one at a time, in this order. Do not retry a refused call and do not use any other tool. Then reply with just OK.\n" +
      steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
  );
  await session.nextResult();
  const calls = toolCalls(session.messages);
  return Object.fromEntries(
    Object.entries(places).map(([name, place]) => [
      name,
      Object.fromEntries(
        FILE_TOOLS.map((tool) => [
          tool,
          lastOutcome(callsOn(calls, tool, tool === "Read" ? place.file : place.folder)),
        ]),
      ),
    ]),
  );
}

/** In a session of its own: after the fence had refused the same file, the model declined to read it by shell. */
async function tryShellRead(session: ProbeSession, file: string): Promise<AttemptOutcome> {
  session.send(
    `Use the Bash tool to run this command: cat "${shellPath(file)}". Do not use any other tool. Then reply with just OK.`,
  );
  await session.nextResult();
  return lastOutcome(
    toolCalls(session.messages).filter(
      (call) => call.name === "Bash" && String(call.input["command"]).includes(basename(file)),
    ),
  );
}

/** Git Bash takes a Windows path with forward slashes. */
function shellPath(path: string): string {
  return path.replaceAll("\\", "/");
}
