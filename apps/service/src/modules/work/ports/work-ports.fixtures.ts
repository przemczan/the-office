import { Injectable, Module } from "@nestjs/common";
import { KnownProjects, type KnownProject } from "./known-projects.js";
import { SessionPeople } from "./session-people.js";

/** The one Project id KnownProjectsForTests doesn't know. */
export const UNKNOWN_PROJECT = "no-such-project";

/** Knows every Project but UNKNOWN_PROJECT, each with Quick fix as its default Pipeline. */
@Injectable()
export class KnownProjectsForTests extends KnownProjects {
  async find(id: string): Promise<KnownProject | undefined> {
    return id === UNKNOWN_PROJECT ? undefined : { id, defaultPipeline: "quick-fix" };
  }
}

/** Each session is the Planner's, but UNKNOWN_SESSION. */
@Injectable()
export class SessionPeopleForTests extends SessionPeople {
  async personInSession(sessionId: string): Promise<string | undefined> {
    return sessionId === UNKNOWN_SESSION ? undefined : "planner";
  }
}

export const UNKNOWN_SESSION = "no-such-session";

/** Provides both, for `WorkModule.register({ imports: [this module] })`. */
@Module({
  providers: [KnownProjectsForTests, SessionPeopleForTests],
  exports: [KnownProjectsForTests, SessionPeopleForTests],
})
export class WorkPortsForTestsModule {}
