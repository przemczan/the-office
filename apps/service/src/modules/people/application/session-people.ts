import { Injectable } from "@nestjs/common";
import type { SessionPeopleSource } from "../ports/session-people-source.js";

/**
 * Where the module keeping Threads gives People whose engine session a call comes from. That
 * module calls People, so it registers here as it starts instead of being called through a port.
 */
@Injectable()
export class SessionPeople implements SessionPeopleSource {
  private source: SessionPeopleSource | undefined;

  provide(source: SessionPeopleSource): void {
    if (this.source) throw new Error("Sessions' people come from one module only.");
    this.source = source;
  }

  async personInSession(sessionId: string): Promise<string | undefined> {
    if (!this.source) throw new Error("No module gives the people in sessions.");
    return this.source.personInSession(sessionId);
  }
}
