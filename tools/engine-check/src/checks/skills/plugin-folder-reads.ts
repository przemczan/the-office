import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import type { ProbeSession, SessionSpec } from "../../probe-session.ts";
import { toolCalls, type ToolCallOutcome } from "../tool-calls.ts";
import { skill } from "./fixtures.ts";
import { samePath } from "./skill-observations.ts";

const SUPPORTING_FILE = "reference.md";

/** Ways to let a session read its plugin folder, each tried in its own session; the first is the Office's options alone. */
const GRANTS: Readonly<Record<string, (pluginFolder: string) => Partial<SessionSpec>>> = {
  officeOptions: () => ({}),
  readAllowRule: (pluginFolder) => ({ settings: { permissions: { allow: [`Read(${rulePath(pluginFolder)}/**)`] } } }),
  permissionsAdditionalDirectory: (pluginFolder) => ({ settings: { permissions: { additionalDirectories: [pluginFolder] } } }),
  additionalDirectoriesOption: (pluginFolder) => ({ options: { additionalDirectories: [pluginFolder] } }),
};

type ReadOutcome = ToolCallOutcome | "not attempted";

/**
 * Whether the Read tool may read a supporting file in the session plugin's folder, which is outside
 * the working directories, while `blockReadsOutsideWorkingDirectories` is on (spec §6: everyone reads
 * their session's skills folder); a file elsewhere in the Office data directory is the control.
 */
export const pluginFolderReadsCheck: Check = {
  id: "skills.plugin-folder-reads",
  title: "Read of the session plugin's skill folder with blockReadsOutsideWorkingDirectories on",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const outsideFile = join(sandbox.officeData, "elsewhere.txt");
    await mkdir(sandbox.officeData, { recursive: true });
    await writeFile(outsideFile, "Not a skill file.\n");
    const outcomes = await Promise.all(
      Object.entries(GRANTS).map(async ([grant, specFor]) => {
        const sessionId = randomUUID();
        const session = await startSession({
          repository,
          sessionId,
          skills: [skill("notes", { [SUPPORTING_FILE]: "Reference for the notes skill.\n" })],
          ...specFor(sandbox.sessionPluginFolder(sessionId)),
        });
        return [grant, await readBoth(session, outsideFile)] as const;
      }),
    );
    return Object.fromEntries(outcomes);
  },
};

async function readBoth(session: ProbeSession, outsideFile: string): Promise<{ skillFolder: ReadOutcome; outsideFile: ReadOutcome }> {
  const skillFile = join(session.pluginFolder, "skills", "notes", SUPPORTING_FILE);
  session.send(`Use the Read tool on each of these files, one call per file, then reply with just OK.\n${skillFile}\n${outsideFile}`);
  await session.nextResult();
  return { skillFolder: readOutcome(session, skillFile), outsideFile: readOutcome(session, outsideFile) };
}

function readOutcome(session: ProbeSession, path: string): ReadOutcome {
  const reads = toolCalls(session.messages).filter((call) => call.name === "Read" && samePath(String(call.input["file_path"]), path));
  return reads.at(-1)?.outcome ?? "not attempted";
}

/** Permission rules write an absolute path `//`-rooted in POSIX form, a Windows drive as `/c`. */
function rulePath(path: string): string {
  return `/${path.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)}`;
}
