import { Injectable, type OnModuleInit } from "@nestjs/common";
import { SessionPeople as PeopleSessionPeople } from "../../../people/index.js";
import {
  SessionPeople as ProjectsSessionPeople,
  type ActingUser,
  type SessionPeopleSource,
} from "../../../projects/index.js";
import {
  SessionPeople as SkillsSessionPeople,
  type SessionPeopleSource as SkillsSessionPeopleSource,
} from "../../../skills/index.js";
import { ThreadService } from "../../application/thread-service.js";

/**
 * Gives People, Projects and Skills whose engine session an Office action's call comes from, and the user
 * who asked them. Both are read by Conversations, so they can't ask it directly.
 */
@Injectable()
export class SessionPeopleForModules
  implements SessionPeopleSource, SkillsSessionPeopleSource, OnModuleInit
{
  constructor(
    private readonly people: PeopleSessionPeople,
    private readonly projects: ProjectsSessionPeople,
    private readonly skills: SkillsSessionPeople,
    private readonly threads: ThreadService,
  ) {}

  onModuleInit(): void {
    this.people.provide(this);
    this.projects.provide(this);
    this.skills.provide(this);
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
