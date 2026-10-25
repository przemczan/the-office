import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Skill } from "./skill.js";

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
