import { Injectable, Logger } from "@nestjs/common";
import {
  allowedSkillNames,
  expectedSkillNames,
  librarySkillsFor,
  projectSkillsFrom,
  sessionSkillRecord,
  skillOverridesOf,
  suffixMatches,
  type SessionSkill,
  type SessionSkillRecord,
} from "../domain/session-skills.js";
import { SessionSkillsNotFound } from "../domain/session-skills-not-found.js";
import { LibraryFolder } from "../ports/library-folder.js";
import { ProjectSkillFiles } from "../ports/project-skill-files.js";
import { SessionFolders } from "../ports/session-folders.js";
import { SessionSkillRepository } from "../ports/session-skill-repository.js";
import { SkillRepository } from "../ports/skill-repository.js";

/** What a session is started with, and what it must list at its start (spec §5.6). */
export interface PreparedSkills {
  /** The session's own plugin folder, for `plugins` and `permissions.additionalDirectories`. */
  readonly folder: string;
  /** The engine's allowlist. */
  readonly names: readonly string[];
  /** What the session must list at its start, no more and no less. */
  readonly expected: readonly string[];
  /** The engine's `skillOverrides` setting. */
  readonly overrides: Readonly<Record<string, "off">>;
  /** The library skills it got, at their versions. */
  readonly versions: readonly SessionSkill[];
  /** Where an allowed Project skill also allows another of the session's skills. */
  readonly suffixMatches: readonly string[];
}

/** Where a session works, when it works in a Project's checkout. */
export interface SessionProject {
  /** The checkout the session works in, such as a Task's worktree. */
  readonly folder: string;
  readonly useProjectSkills: boolean;
}

export interface SessionSkillRequest {
  readonly sessionId: string;
  /** The skills its Role's card names; the skills for everyone come with them. */
  readonly roleSkills: readonly string[];
  readonly project: SessionProject | undefined;
}

/**
 * Gives each session exactly its skills: a folder of copies at their versions, kept while the
 * session can be resumed and rebuilt from what it recorded, never with a changed set.
 */
@Injectable()
export class SessionSkills {
  private readonly logger = new Logger(SessionSkills.name);

  constructor(
    private readonly skills: SkillRepository,
    private readonly library: LibraryFolder,
    private readonly records: SessionSkillRepository,
    private readonly folders: SessionFolders,
    private readonly projectFiles: ProjectSkillFiles,
  ) {}

  /** For a new session; its set is kept for each resume. */
  async prepare({ sessionId, roleSkills, project }: SessionSkillRequest): Promise<PreparedSkills> {
    const skills = librarySkillsFor(await this.skills.list(), roleSkills);
    const projectSkills = project
      ? projectSkillsFrom(await this.projectFiles.files(project.folder))
      : [];
    const record = sessionSkillRecord(
      sessionId,
      skills,
      projectSkills,
      project?.useProjectSkills ?? false,
      new Date(),
    );
    await this.records.add(record);
    let prepared: PreparedSkills;
    try {
      prepared = await this.write(record);
    } catch (error) {
      await this.forget(sessionId);
      throw error;
    }
    for (const match of prepared.suffixMatches) this.logger.warn(match);
    return prepared;
  }

  /**
   * For a resume: the folder written again from the versions the session recorded. Throws
   * SessionSkillsNotFound for a session it has no record of, and SkillVersionMissing when the
   * library no longer has one of its versions.
   */
  async rebuild(sessionId: string): Promise<PreparedSkills> {
    const record = await this.records.find(sessionId);
    if (!record) throw new SessionSkillsNotFound(sessionId);
    return this.write(record);
  }

  /** For a session that won't be resumed: its folder and record go. */
  async forget(sessionId: string): Promise<void> {
    await this.folders.remove(sessionId);
    await this.records.remove(sessionId);
  }

  /**
   * Removes what nothing needs any more: the folders of sessions with no record, and library
   * versions that are neither a skill's current one nor recorded by a session. Run before
   * anything keeps a new version, as at the service's start.
   */
  async sweep(): Promise<void> {
    const records = await this.records.list();
    const sessions = new Set(records.map((record) => record.sessionId));
    await this.folders.prune((sessionId) => sessions.has(sessionId));
    const needed = new Set([
      ...(await this.skills.list()).map((skill) => versionKey(skill.name, skill.filesHash)),
      ...records.flatMap((record) =>
        record.skills.map((skill) => versionKey(skill.name, skill.filesHash)),
      ),
    ]);
    await this.library.prune((skillName, filesHash) =>
      needed.has(versionKey(skillName, filesHash)),
    );
  }

  private async write(record: SessionSkillRecord): Promise<PreparedSkills> {
    const skills = await Promise.all(
      record.skills.map(async (skill) => ({
        name: skill.name,
        files: await this.library.read(skill.name, skill.filesHash),
      })),
    );
    const folder = await this.folders.write(record.sessionId, skills);
    return {
      folder,
      names: allowedSkillNames(record),
      expected: expectedSkillNames(record),
      overrides: skillOverridesOf(record),
      versions: record.skills,
      suffixMatches: suffixMatches(record),
    };
  }
}

function versionKey(skillName: string, filesHash: string): string {
  return `${skillName}/${filesHash}`;
}
