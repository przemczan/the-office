import { Injectable, type OnModuleInit } from "@nestjs/common";
import { SessionPeople, type SessionPeopleSource } from "../../../people/index.js";
import { ThreadService } from "../../application/thread-service.js";

/** Gives People whose engine session an Office action's call comes from. */
@Injectable()
export class SessionPeopleForPeople implements SessionPeopleSource, OnModuleInit {
  constructor(
    private readonly people: SessionPeople,
    private readonly threads: ThreadService,
  ) {}

  onModuleInit(): void {
    this.people.provide(this);
  }

  personInSession(sessionId: string): Promise<string | undefined> {
    return this.threads.personInSession(sessionId);
  }
}
