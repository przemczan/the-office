import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { SESSION_PLUGIN } from "../../domain/session-skills.js";
import { SessionFolders, type SessionFolderSkill } from "../../ports/session-folders.js";
import { skillNameProblems } from "../../domain/skill.js";
import { namesIn, writeSkillFiles, writeWhole } from "./skill-file-folders.js";

/** Session ids name folders, so none may lead out of the sessions folder. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SKILLS = "skills";

/**
 * `<office-data>/sessions/<session id>/skills/`: `.claude-plugin/plugin.json` naming the plugin
 * `office`, whatever the folder is called, and each skill in `skills/<name>/` (spec §5.6). The
 * session's folder also holds what an engine keeps to resume it, and goes with the skills.
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
    await mkdir(this.sessionFolder(sessionId), { recursive: true });
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
    await rm(this.sessionFolder(sessionId), { recursive: true, force: true });
  }

  async prune(keep: (sessionId: string) => boolean): Promise<void> {
    for (const sessionId of await namesIn(this.path)) {
      if (SESSION_ID.test(sessionId) && !keep(sessionId)) await this.remove(sessionId);
    }
  }

  private skillsFolder(sessionId: string): string {
    return join(this.sessionFolder(sessionId), SKILLS);
  }

  private sessionFolder(sessionId: string): string {
    if (!SESSION_ID.test(sessionId))
      throw new Error(`"${sessionId}" can't name a session's folder.`);
    return join(this.path, sessionId);
  }
}
