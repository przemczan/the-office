import type { SessionSkillRecord } from "../domain/session-skills.js";

/** Where what each session got is kept, until the session can't be resumed. */
export abstract class SessionSkillRepository {
  /** Throws SkillRefused when the session already has its skills: a set is never changed. */
  abstract add(record: SessionSkillRecord): Promise<void>;

  abstract find(sessionId: string): Promise<SessionSkillRecord | undefined>;

  /** Every record, oldest first. */
  abstract list(): Promise<readonly SessionSkillRecord[]>;

  /** Does nothing when there is no such record. */
  abstract remove(sessionId: string): Promise<void>;
}
