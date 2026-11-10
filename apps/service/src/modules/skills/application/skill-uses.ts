import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { SkillCalled } from "../../engine/index.js";
import { SkillUsed } from "../domain/skill-events.js";
import { skillUseWindowStart, usedSkillOf } from "../domain/skill-uses.js";
import { SessionSkillRepository } from "../ports/session-skill-repository.js";
import { SkillUseRepository } from "../ports/skill-use-repository.js";

/** The daily job's name in the schedule. */
export const SKILL_USE_PRUNE = "The prune of skill uses";

/**
 * Each skill's Skill uses (spec §2.6): every Skill call a session makes, on any engine, counted
 * for the skill that session got from The Office under that name, and kept for 7 days.
 */
@Injectable()
export class SkillUses implements OnModuleInit {
  constructor(
    private readonly uses: SkillUseRepository,
    private readonly records: SessionSkillRepository,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(SkillCalled, (called) => this.count(called));
  }

  /** Runs on the schedule: once at the start, then daily. */
  startPruning(): void {
    this.schedule.daily(SKILL_USE_PRUNE, () => this.prune());
  }

  /** Each library skill's uses in the last 7 days, by its name; a skill with none is left out. */
  libraryCounts(): Promise<ReadonlyMap<string, number>> {
    return this.uses.libraryCounts(skillUseWindowStart(this.schedule.now()));
  }

  /** Each of the Project's skills' uses in the last 7 days, by its key; a key with none is left out. */
  projectCounts(projectId: string): Promise<ReadonlyMap<string, number>> {
    return this.uses.projectCounts(projectId, skillUseWindowStart(this.schedule.now()));
  }

  /** Removes the uses that no longer count. */
  async prune(): Promise<void> {
    await this.uses.removeUntil(skillUseWindowStart(this.schedule.now()));
  }

  /** A call naming none of the session's skills, or from a session with no record, isn't counted. */
  private async count({ sessionId, skill: called, calledAt }: SkillCalled): Promise<void> {
    const record = await this.records.find(sessionId);
    const skill = record && usedSkillOf(record, called);
    if (skill === undefined) return;
    const use = { sessionId, skill, usedAt: calledAt };
    if (await this.uses.add(use)) await this.events.publish(new SkillUsed(use));
  }
}
