import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { PinnedVersion } from "../domain/installed-source.js";
import type { Skill } from "../domain/skill.js";
import { noteSourceVersion } from "../domain/skill-changes.js";
import { SkillNotFound } from "../domain/skill-not-found.js";
import { SkillRefused } from "../domain/skill-refused.js";
import { SkillRepository } from "../ports/skill-repository.js";
import { SkillSources } from "./skill-sources.js";

/** The daily job's name in the schedule. */
export const SKILL_UPDATE_CHECK = "The skill update check";

/**
 * Finds the updates of installed skills (spec §2.6): reads each Source's pinned version with
 * `git ls-remote`, which spends no quota, and marks a skill whose Source has a newer one.
 */
@Injectable()
export class SkillUpdates {
  private readonly logger = new Logger(SkillUpdates.name);

  constructor(
    private readonly repository: SkillRepository,
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

function installedByRepository(skills: readonly Skill[]): Map<string, Skill[]> {
  const byRepository = new Map<string, Skill[]>();
  for (const skill of skills) {
    if (!skill.installedFrom) continue;
    const { repository } = skill.installedFrom;
    byRepository.set(repository, [...(byRepository.get(repository) ?? []), skill]);
  }
  return byRepository;
}
