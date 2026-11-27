import { Injectable } from "@nestjs/common";
import type { ActingUser } from "../domain/acted-by.js";
import type { SessionPeopleSource } from "../ports/session-people-source.js";

/**
 * Where the module keeping Threads gives Projects whose engine session a call comes from. That
 * module reads Projects, so it registers here as it starts instead of being called through a port.
 */
@Injectable()
export class SessionPeople implements SessionPeopleSource {
  private source: SessionPeopleSource | undefined;

  provide(source: SessionPeopleSource): void {
    if (this.source) throw new Error("Sessions' people come from one module only.");
    this.source = source;
  }

  async personInSession(sessionId: string): Promise<string | undefined> {
    return this.given().personInSession(sessionId);
  }

  async taskInSession(sessionId: string): Promise<string | undefined> {
    return this.given().taskInSession(sessionId);
  }

  async askedByInSession(sessionId: string): Promise<ActingUser | undefined> {
    return this.given().askedByInSession(sessionId);
  }

  private given(): SessionPeopleSource {
    if (!this.source) throw new Error("No module gives the people in sessions.");
    return this.source;
  }
}
