import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  isUpdateOf,
  pinnedVersionLabel,
  type InstalledSource,
  type PinnedVersion,
} from "../domain/installed-source.js";
import type { Skill } from "../domain/skill.js";
import { applyUpdate, noteSourceVersion } from "../domain/skill-changes.js";
import { checkSameSkill } from "../domain/skill-draft.js";
import { skillFilesHash } from "../domain/skill-files.js";
import { SkillNotFound } from "../domain/skill-not-found.js";
import { SkillRefused } from "../domain/skill-refused.js";
import {
  cutDiff,
  noUpdates,
  UPDATE_DIFF_BYTES,
  updateProblem,
  type ProposedUpdate,
  type SkillUpdateDiff,
} from "../domain/skill-update.js";
import { LibraryFolder } from "../ports/library-folder.js";
import { SkillRepository } from "../ports/skill-repository.js";
import { SkillSources } from "./skill-sources.js";

/** The daily job's name in the schedule. */
export const SKILL_UPDATE_CHECK = "The skill update check";

/** An installed skill's update as Devops drafts it: its Source's files at the newer pinned version. */
export interface SkillUpdateDraft extends ProposedUpdate {
  readonly repository: string;
  readonly folder: string;
  /** Its SKILL.md's description at `to`. */
  readonly description: string;
  /** Its files' paths at `to`, in its folder. */
  readonly files: readonly string[];
  readonly filesHash: string;
}

/** An update the user applies: as proposed, with the files hash it was proposed with. */
export interface AppliedUpdate extends ProposedUpdate {
  readonly filesHash: string;
}

/**
 * The updates of installed skills (spec §2.6): the daily check that finds them with `git ls-remote`,
 * which spends no quota, and the update Devops drafts and the user applies, which is its review.
 */
@Injectable()
export class SkillUpdates {
  private readonly logger = new Logger(SkillUpdates.name);

  constructor(
    private readonly repository: SkillRepository,
    private readonly folder: LibraryFolder,
    private readonly sources: SkillSources,
    private readonly events: EventBus,
  ) {}

  /** Reads each Source once, one after another; a Source it can't read keeps what it noted. */
  async check(): Promise<void> {
    for (const [repository, skills] of installedByRepository(await this.repository.list())) {
      const now = await this.pinnedVersionNow(repository);
      if (!now) continue;
      for (const skill of skills) await this.note(skill.name, now);
    }
  }

  /**
   * The skill's update at its Source's pinned version now, read for a Proposal. Refuses when the
   * skill wasn't installed, its Source has nothing newer, or holds another skill there now.
   */
  async draft(name: string): Promise<SkillUpdateDraft> {
    const installedFrom = installedSourceOf(await this.read(name));
    const from = installedFrom.pinnedVersion;
    const to = await this.sources.pinnedVersion(installedFrom.repository);
    if (!isUpdateOf(to, from)) {
      throw new SkillRefused([
        `${name} is pinned at ${pinnedVersionLabel(from)}, the newest version of ${installedFrom.repository}.`,
      ]);
    }
    const draft = await this.sources.draft({ ...installedFrom, pinnedVersion: to });
    checkSameSkill(draft, name);
    return {
      name,
      repository: installedFrom.repository,
      folder: installedFrom.folder,
      from,
      to,
      description: draft.skill.description,
      files: draft.files.map((file) => file.path),
      filesHash: skillFilesHash(draft.files),
    };
  }

  /**
   * What an update of the skill from `from` to `to` changes in its files, at its Source; the same
   * once applied, so an applied update's card still shows it.
   */
  async diff(name: string, from: PinnedVersion, to: PinnedVersion): Promise<SkillUpdateDiff> {
    const installedFrom = installedSourceOf(await this.read(name));
    const diff = await this.sources.diff({ ...installedFrom, pinnedVersion: from }, to);
    return { from, to, ...cutDiff(diff, UPDATE_DIFF_BYTES) };
  }

  /** Why the update can't be applied now, which needs no Source read; empty when it can. */
  async problems(update: ProposedUpdate): Promise<readonly string[]> {
    const skill = await this.repository.find(update.name);
    if (!skill) return [new SkillNotFound(update.name).message];
    const problem = updateProblem(skill, update);
    return problem === undefined ? [] : [problem];
  }

  /**
   * Fetches the update's files and pins the skill there, on or off as it was. Refuses a stale
   * update, or files that are no longer the ones proposed.
   */
  async apply(update: AppliedUpdate): Promise<Skill> {
    const [problem] = await this.problems(update);
    if (problem !== undefined) throw new SkillRefused([problem]);
    const skill = await this.read(update.name);
    const installedFrom = installedSourceOf(skill);
    const draft = await this.sources.draft({
      ...installedFrom,
      pinnedVersion: update.to,
      filesHash: update.filesHash,
    });
    checkSameSkill(draft, update.name);
    const filesHash = await this.folder.keep(update.name, draft.files);
    const { skill: updated, event } = await this.repository.update(update.name, (current) =>
      applyUpdate(current, update, { description: draft.skill.description, filesHash }, new Date()),
    );
    if (event) await this.events.publish(event);
    return updated;
  }

  private async read(name: string): Promise<Skill> {
    const skill = await this.repository.find(name);
    if (!skill) throw new SkillNotFound(name);
    return skill;
  }

  private async pinnedVersionNow(repository: string): Promise<PinnedVersion | undefined> {
    try {
      return await this.sources.pinnedVersion(repository);
    } catch (error) {
      if (!(error instanceof SkillRefused)) throw error;
      // A Source can be offline for a day, or gone; the skill stays as it is either way.
      this.logger.log(`No update check for ${repository}: ${error.reasons.join(" ")}`);
      return undefined;
    }
  }

  private async note(name: string, now: PinnedVersion): Promise<void> {
    try {
      const { event } = await this.repository.update(name, (skill) =>
        noteSourceVersion(skill, now),
      );
      if (event) await this.events.publish(event);
    } catch (error) {
      // Removed since the check listed it.
      if (!(error instanceof SkillNotFound)) throw error;
    }
  }
}

function installedSourceOf(skill: Skill): InstalledSource {
  if (!skill.installedFrom) throw new SkillRefused([noUpdates(skill.name)]);
  return skill.installedFrom;
}

function installedByRepository(skills: readonly Skill[]): Map<string, Skill[]> {
  const byRepository = new Map<string, Skill[]>();
  for (const skill of skills) {
    if (!skill.installedFrom) continue;
    const { repository } = skill.installedFrom;
    byRepository.set(repository, [...(byRepository.get(repository) ?? []), skill]);
  }
  return byRepository;
}
