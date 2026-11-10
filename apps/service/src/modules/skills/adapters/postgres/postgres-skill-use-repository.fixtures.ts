import { randomUUID } from "node:crypto";
import type { SkillUse, UsedSkill } from "../../domain/skill-uses.js";

/** A use of `skill` at `usedAt`, in a session of its own. */
export function aUse(skill: UsedSkill, usedAt: Date): SkillUse {
  return { sessionId: randomUUID(), skill, usedAt };
}

/** A Project of this test's own: every test file shares the database. */
export function aProjectOfItsOwn(): string {
  return `project-${randomUUID()}`;
}
