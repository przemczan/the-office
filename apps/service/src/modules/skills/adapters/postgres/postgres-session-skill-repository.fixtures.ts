import { randomUUID } from "node:crypto";
import type { SessionSkillRecord } from "../../domain/session-skills.js";

/** A record of this test's own: every test file shares the database. */
export function aRecord(fields: Partial<SessionSkillRecord> = {}): SessionSkillRecord {
  return {
    sessionId: randomUUID(),
    skills: [{ name: "tdd", version: 2, filesHash: "a".repeat(64) }],
    projectId: "admin-panel",
    projectSkills: [
      { key: "deploy", listedAs: "deploy" },
      { key: "release", listedAs: undefined },
    ],
    projectSkillsOff: [],
    preparedAt: new Date("2026-10-25T12:00:00.000Z"),
    ...fields,
  };
}
