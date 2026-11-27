import { Injectable } from "@nestjs/common";
import type { UserRef } from "../domain/user.js";
import type { SessionPeopleSource } from "../ports/session-people-source.js";

/**
 * Where the module keeping Threads gives Skills the user behind an engine session's call. That
 * module reads Skills, so it registers here as it starts instead of being called through a port.
 */
@Injectable()
export class SessionPeople implements SessionPeopleSource {
  private source: SessionPeopleSource | undefined;

  provide(source: SessionPeopleSource): void {
    if (this.source) throw new Error("Sessions' people come from one module only.");
    this.source = source;
  }

  async askedByInSession(sessionId: string): Promise<UserRef | undefined> {
    if (!this.source) throw new Error("No module gives the people in sessions.");
    return this.source.askedByInSession(sessionId);
  }
}
