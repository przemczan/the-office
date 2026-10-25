import { mkdir, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { SESSION_PLUGIN } from "../../domain/session-skills.js";
import { SessionFolders, type SessionFolderSkill } from "../../ports/session-folders.js";
import { skillNameProblems } from "../../domain/skill.js";
import { namesIn, UNFINISHED, writeSkillFiles, writeWhole } from "./skill-file-folders.js";

/** Session ids name folders, so none may lead out of the sessions folder. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SKILLS = "skills";

/**
 * `<office-data>/sessions/<session id>/skills/`: `.claude-plugin/plugin.json` naming the plugin
 * `office`, whatever the folder is called, and each skill in `skills/<name>/` (spec §5.6).
 */
@Injectable()
export class FilesystemSessionFolders extends SessionFolders {
  private readonly path: string;

  constructor(officeData: OfficeDataDirectory) {
    super();
    this.path = officeData.folder("sessions");
  }

  async write(sessionId: string, skills: readonly SessionFolderSkill[]): Promise<string> {
    const folder = this.skillsFolder(sessionId);
    await mkdir(join(this.path, sessionId), { recursive: true });
    await writeWhole(
      folder,
      async (writing) => {
        await mkdir(join(writing, ".claude-plugin"));
        await writeFile(
          join(writing, ".claude-plugin", "plugin.json"),
          `${JSON.stringify({ name: SESSION_PLUGIN })}\n`,
          { flag: "wx" },
        );
        for (const skill of skills) {
          if (skillNameProblems(skill.name).length > 0) {
            throw new Error(`"${skill.name}" can't name a skill's folder.`);
          }
          await writeSkillFiles(join(writing, SKILLS, skill.name), skill.files);
        }
      },
      { replace: true },
    );
    return folder;
  }

  async remove(sessionId: string): Promise<void> {
    await rm(this.skillsFolder(sessionId), { recursive: true, force: true });
    const sessionFolder = join(this.path, sessionId);
    for (const unfinished of (await namesIn(sessionFolder)).filter((name) =>
      UNFINISHED.test(name),
    )) {
      await rm(join(sessionFolder, unfinished), { recursive: true, force: true });
    }
    await removeIfEmpty(sessionFolder);
  }

  async prune(keep: (sessionId: string) => boolean): Promise<void> {
    for (const sessionId of await namesIn(this.path)) {
      if (SESSION_ID.test(sessionId) && !keep(sessionId)) await this.remove(sessionId);
    }
  }

  private skillsFolder(sessionId: string): string {
    if (!SESSION_ID.test(sessionId))
      throw new Error(`"${sessionId}" can't name a session's folder.`);
    return join(this.path, sessionId, SKILLS);
  }
}

/** Other things of the session's may share its folder, so only an empty one goes. */
async function removeIfEmpty(folder: string): Promise<void> {
  const names = await readdir(folder).catch(() => undefined);
  if (names?.length === 0) await rmdir(folder);
}
