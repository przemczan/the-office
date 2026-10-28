import { Injectable } from "@nestjs/common";
import {
  pinnedVersionLabel,
  pinnedVersionOf,
  sourceFolderProblem,
  sourceRepositoryProblems,
  sourceUrl,
  type InstalledSource,
  type PinnedVersion,
} from "../domain/installed-source.js";
import type { SkillDraft } from "../domain/skill-draft.js";
import { skillFilesHash } from "../domain/skill-files.js";
import { SkillRefused } from "../domain/skill-refused.js";
import {
  installedDraft,
  SOURCE_FOLDER_LIMITS,
  type SourceFolder,
} from "../domain/source-skills.js";
import { SourceFetcher, SourceNotFetched } from "../ports/source-fetcher.js";

/** A skill to install: its Source and pinned version, and the files hash it was proposed with. */
export interface SkillInstall extends InstalledSource {
  /** When given, the Source's files must still have it. */
  readonly filesHash?: string;
}

/** A skill a Source holds, as installing it would add it, or every reason it can't be installed. */
export type SourceSkill =
  | {
      readonly folder: string;
      readonly name: string;
      readonly description: string;
      /** Its files' paths, in its folder. */
      readonly files: readonly string[];
      readonly filesHash: string;
    }
  | { readonly folder: string; readonly problems: readonly string[] };

/** What a Source holds at the version it would be pinned at now. */
export interface SourceSkills {
  readonly repository: string;
  readonly pinnedVersion: PinnedVersion;
  readonly skills: readonly SourceSkill[];
}

/**
 * Reads the Sources skills are installed from (spec §2.6), refusing with SkillRefused, in words the
 * user or Devops acts on, when one can't be read.
 */
@Injectable()
export class SkillSources {
  constructor(private readonly fetcher: SourceFetcher) {}

  /** The Source's pinned version now: its newest tag, or its newest commit when it has none. */
  async pinnedVersion(repository: string): Promise<PinnedVersion> {
    const given = checkedRepository(repository);
    const refs = await this.reading(given, () => this.fetcher.refs(sourceUrl(given)));
    const pinnedVersion = pinnedVersionOf(refs);
    if (!pinnedVersion) throw new SkillRefused([`${given} has no commits yet.`]);
    return pinnedVersion;
  }

  /** The skills the Source holds at its pinned version now, or only the one in `folder`. */
  async skills(repository: string, folder?: string): Promise<SourceSkills> {
    const given = checkedRepository(repository);
    if (folder !== undefined) checkFolder(folder);
    const pinnedVersion = await this.pinnedVersion(given);
    const folders = await this.foldersAt({ repository: given, pinnedVersion }, folder);
    return {
      repository: given,
      pinnedVersion,
      skills: folders.map((fetched) =>
        sourceSkillOf({ repository: given, folder: fetched.folder, pinnedVersion }, fetched),
      ),
    };
  }

  /**
   * The skill in the Source's folder at its pinned version, as installing it adds it. Refuses when
   * the Source can't be read, holds no skill there, or its files no longer have the expected hash.
   */
  async draft(install: SkillInstall): Promise<SkillDraft> {
    const source: InstalledSource = {
      repository: checkedRepository(install.repository),
      folder: install.folder,
      pinnedVersion: install.pinnedVersion,
    };
    checkFolder(source.folder);
    const [fetched] = await this.foldersAt(source, source.folder);
    if (!fetched) {
      const where = source.folder === "" ? "at its top" : `in "${source.folder}"`;
      throw new SkillRefused([
        `${source.repository} has no skill ${where} at ${pinnedVersionLabel(source.pinnedVersion)}.`,
      ]);
    }
    const draft = installedDraft(source, fetched);
    if (install.filesHash !== undefined && skillFilesHash(draft.files) !== install.filesHash) {
      throw new SkillRefused([
        `${draft.skill.name}'s files at ${source.repository} are not the ones proposed.`,
      ]);
    }
    return draft;
  }

  /** The unified diff of the skill's folder from its pinned version to `to`, paths inside the folder. */
  async diff(source: InstalledSource, to: PinnedVersion): Promise<string> {
    return this.reading(source.repository, () =>
      this.fetcher.diff({
        url: sourceUrl(source.repository),
        folder: source.folder,
        from: source.pinnedVersion,
        to,
      }),
    );
  }

  private foldersAt(
    source: Pick<InstalledSource, "repository" | "pinnedVersion">,
    folder: string | undefined,
  ): Promise<readonly SourceFolder[]> {
    return this.reading(source.repository, () =>
      this.fetcher.skillFolders({
        url: sourceUrl(source.repository),
        pinnedVersion: source.pinnedVersion,
        ...(folder !== undefined && { folder }),
        limits: SOURCE_FOLDER_LIMITS,
      }),
    );
  }

  private async reading<Result>(repository: string, read: () => Promise<Result>): Promise<Result> {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof SourceNotFetched)) throw error;
      throw new SkillRefused([`Could not read ${repository}: ${error.detail}`]);
    }
  }
}

/** The repository as given, without the spaces around it; refuses one that is no Source. */
function checkedRepository(repository: string): string {
  const given = repository.trim();
  const problems = sourceRepositoryProblems(given);
  if (problems.length > 0) throw new SkillRefused(problems);
  return given;
}

function checkFolder(folder: string): void {
  const problem = sourceFolderProblem(folder);
  if (problem !== undefined) throw new SkillRefused([problem]);
}

function sourceSkillOf(source: InstalledSource, fetched: SourceFolder): SourceSkill {
  try {
    const { skill, files } = installedDraft(source, fetched);
    return {
      folder: source.folder,
      name: skill.name,
      description: skill.description,
      files: files.map((file) => file.path),
      filesHash: skillFilesHash(files),
    };
  } catch (error) {
    if (!(error instanceof SkillRefused)) throw error;
    return { folder: source.folder, problems: error.reasons };
  }
}
