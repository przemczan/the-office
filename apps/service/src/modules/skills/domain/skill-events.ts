import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { PinnedVersion } from "./installed-source.js";
import type { RoleSkillsChange } from "./role-skills.js";
import type { Skill } from "./skill.js";
import type { SkillUse } from "./skill-uses.js";

/** It arrives waiting for review. */
export class SkillAdded extends DomainEvent {
  constructor(readonly skill: Skill) {
    super(skill.addedAt);
  }
}

/** The new version waits for review; running sessions keep the version they started with. */
export class SkillVersionSaved extends DomainEvent {
  constructor(readonly skill: Skill) {
    super(skill.savedAt);
  }
}

/** Its Source has a newer pinned version, which Devops can propose as an update. */
export class SkillUpdateFound extends DomainEvent {
  constructor(
    readonly skillName: string,
    readonly update: PinnedVersion,
  ) {
    super();
  }
}

/** The update found before is no longer at its Source. */
export class SkillUpdateGone extends DomainEvent {
  constructor(readonly skillName: string) {
    super();
  }
}

/**
 * Pinned at its update's version, as the user applied it: on or off as it was, since applying is
 * its review (spec §2.6). Running sessions keep the version they started with.
 */
export class SkillUpdated extends DomainEvent {
  constructor(readonly skill: Skill) {
    super();
  }
}

/** Sessions started from now on get it at `version`. */
export class SkillTurnedOn extends DomainEvent {
  constructor(
    readonly skillName: string,
    readonly version: number,
  ) {
    super();
  }
}

export class SkillTurnedOff extends DomainEvent {
  constructor(readonly skillName: string) {
    super();
  }
}

/** Applies at each session start from now on. */
export class SkillEveryoneChanged extends DomainEvent {
  constructor(
    readonly skillName: string,
    readonly everyone: boolean,
  ) {
    super();
  }
}

export class SkillRemoved extends DomainEvent {
  constructor(readonly skillName: string) {
    super();
  }
}

/** A Role's next sessions get its new skills; running ones keep theirs. */
export class RoleSkillsChanged extends DomainEvent {
  constructor(readonly change: RoleSkillsChange) {
    super(change.changedAt);
  }
}

/** A session used a skill it got from The Office, so the skill's count in the last 7 days grew. */
export class SkillUsed extends DomainEvent {
  constructor(readonly use: SkillUse) {
    super(use.usedAt);
  }
}
