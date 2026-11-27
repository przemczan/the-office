import { Injectable, type OnModuleInit } from "@nestjs/common";
import { SessionPeople as PeopleSessionPeople } from "../../../people/index.js";
import {
  SessionPeople as ProjectsSessionPeople,
  type ActingUser,
  type SessionPeopleSource,
} from "../../../projects/index.js";
import { ThreadService } from "../../application/thread-service.js";

/**
 * Gives People and Projects whose engine session an Office action's call comes from, and the user
 * who asked them. Both are read by Conversations, so they can't ask it directly.
 */
@Injectable()
export class SessionPeopleForModules implements SessionPeopleSource, OnModuleInit {
  constructor(
    private readonly people: PeopleSessionPeople,
    private readonly projects: ProjectsSessionPeople,
    private readonly threads: ThreadService,
  ) {}

  onModuleInit(): void {
    this.people.provide(this);
    this.projects.provide(this);
  }

  personInSession(sessionId: string): Promise<string | undefined> {
    return this.threads.personInSession(sessionId);
  }

  taskInSession(sessionId: string): Promise<string | undefined> {
    return this.threads.taskInSession(sessionId);
  }

  async askedByInSession(sessionId: string): Promise<ActingUser | undefined> {
    const user = await this.threads.askedByInSession(sessionId);
    return user && { userId: user.userId, name: user.name };
  }
}
