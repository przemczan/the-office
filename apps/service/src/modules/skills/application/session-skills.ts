import { Injectable, Logger } from "@nestjs/common";
import {
  allowedSkillNames,
  expectedSkillNames,
  librarySkillsFor,
  projectSkillNamesFrom,
  sessionSkillRecord,
  skillOverridesOf,
  suffixMatches,
  type ProjectSkillUse,
  type SessionSkill,
  type SessionSkillRecord,
} from "../domain/session-skills.js";
import { skillsOfRole } from "../domain/role-skills.js";
import { SessionSkillsNotFound } from "../domain/session-skills-not-found.js";
import type { SkillFile } from "../domain/skill-files.js";
import { SkillVersionNotKept } from "../domain/skill-version-missing.js";
import { LibraryFolder } from "../ports/library-folder.js";
import { ProjectSkillFiles } from "../ports/project-skill-files.js";
import { RoleSkillRepository } from "../ports/role-skill-repository.js";
import { SessionFolders } from "../ports/session-folders.js";
import { SessionSkillRepository } from "../ports/session-skill-repository.js";
import { SkillRepository } from "../ports/skill-repository.js";

/** What a session is started with, and what it must list at its start (spec §5.6). */
export interface PreparedSkills {
  /** The session's own plugin folder, loaded as a plugin and readable by the session's file tools. */
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

/** A session outside a Project's checkout has no repository to find skills in. */
const NO_PROJECT_SKILLS: ProjectSkillUse = { useProjectSkills: false, projectSkillsOff: [] };

/** Where a session works, when it works in a Project's checkout. */
export interface SessionProject extends ProjectSkillUse {
  /** The Project's id, which its skills' uses are counted under. */
  readonly id: string;
  /** The checkout the session works in, such as a Task's worktree. */
  readonly folder: string;
}

export interface SessionSkillRequest {
  readonly sessionId: string;
  /** The key of the Role the session works in: it gets the Role's skills and those for everyone. */
  readonly roleKey: string;
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
    private readonly roleSkills: RoleSkillRepository,
  ) {}

  /**
   * For a new session; its set is kept for each resume. A skill removed from the library while
   * the session is prepared is left out, and the session starts without it.
   */
  async prepare({ sessionId, roleKey, project }: SessionSkillRequest): Promise<PreparedSkills> {
    const roleSkills = skillsOfRole(await this.roleSkills.list(), roleKey);
    const listed = librarySkillsFor(await this.skills.list(), roleSkills);
    const skills = await this.filesOfThoseStillListed(sessionId, listed);
    const projectSkills = project
      ? projectSkillNamesFrom(await this.projectFiles.files(project.folder))
      : [];
    const record = sessionSkillRecord(
      sessionId,
      skills.map(({ skill }) => skill),
      project?.id,
      projectSkills,
      project ?? NO_PROJECT_SKILLS,
      new Date(),
    );
    await this.records.add(record);
    let prepared: PreparedSkills;
    try {
      prepared = await this.write(record, skills);
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
    const skills = await Promise.all(
      record.skills.map(async (skill) => ({
        skill,
        files: await this.library.read(skill.name, skill.filesHash),
      })),
    );
    return this.write(record, skills);
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

  /**
   * The listed skills' files, leaving out those the library no longer lists once read. A skill
   * removed keeps its files until the next sweep, but not one whose files were never kept here.
   */
  private async filesOfThoseStillListed(
    sessionId: string,
    listed: readonly SessionSkill[],
  ): Promise<SessionSkillFiles[]> {
    const reads = await Promise.all(
      listed.map(async (skill) => ({
        skill,
        files: await filesOrNotKept(this.library.read(skill.name, skill.filesHash)),
      })),
    );
    const stillListed = new Set((await this.skills.list()).map((skill) => skill.name));
    const kept: SessionSkillFiles[] = [];
    for (const { skill, files } of reads) {
      if (!stillListed.has(skill.name)) {
        this.logger.log(
          `${skill.name} was removed from the library while session ${sessionId} was prepared; the session starts without it.`,
        );
      } else if (files instanceof SkillVersionNotKept) {
        throw files;
      } else {
        kept.push({ skill, files });
      }
    }
    return kept;
  }

  private async write(
    record: SessionSkillRecord,
    skills: readonly SessionSkillFiles[],
  ): Promise<PreparedSkills> {
    const folder = await this.folders.write(
      record.sessionId,
      skills.map(({ skill, files }) => ({ name: skill.name, files })),
    );
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

/** A library skill at the version a session gets, with that version's files. */
interface SessionSkillFiles {
  readonly skill: SessionSkill;
  readonly files: readonly SkillFile[];
}

async function filesOrNotKept(
  read: Promise<readonly SkillFile[]>,
): Promise<readonly SkillFile[] | SkillVersionNotKept> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof SkillVersionNotKept) return error;
    throw error;
  }
}

function versionKey(skillName: string, filesHash: string): string {
  return `${skillName}/${filesHash}`;
}
