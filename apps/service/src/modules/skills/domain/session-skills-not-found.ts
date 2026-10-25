/** A session that never got its skills, or whose record went when it could no longer resume. */
export class SessionSkillsNotFound extends Error {
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} has no skills recorded.`);
    this.name = "SessionSkillsNotFound";
  }
}
