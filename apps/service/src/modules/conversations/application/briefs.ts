import { Injectable } from "@nestjs/common";
import {
  freshChatThreadBrief,
  initiativeThreadBrief,
  newChatThreadBrief,
  taskThreadBrief,
  type Brief,
} from "../domain/brief.js";
import type { Thread } from "../domain/thread.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { InitiativeThreadSetups, type InitiativeThreadSetup } from "./initiative-thread-setups.js";
import { SessionMemory } from "./session-memory.js";
import { TaskThreadSetups, type TaskThreadSetup } from "./task-thread-setups.js";

/** Assembles each new session's Brief from the record, with no model call (spec §2.5). */
@Injectable()
export class Briefs {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly bases: ProjectBases,
    private readonly taskThreads: TaskThreadSetups,
    private readonly initiativeThreads: InitiativeThreadSetups,
    private readonly memory: SessionMemory,
  ) {}

  /** The Brief of the Thread's next session. Read before the message it answers is logged. */
  async forThread(thread: Thread): Promise<Brief> {
    const { home } = thread;
    switch (home.kind) {
      case "chat":
        return this.forChatThread(thread);
      case "task":
        return this.forTaskThread(
          thread,
          await this.taskThreads.of({
            threadId: thread.id,
            taskId: home.taskId,
            roleKey: thread.roleKey,
          }),
        );
      case "initiative":
        return this.forInitiativeThread(
          thread,
          await this.initiativeThreads.of({
            threadId: thread.id,
            initiativeId: home.initiativeId,
            roleKey: thread.roleKey,
          }),
        );
    }
  }

  /**
   * As `forThread`, from the setup the session is about to start with: the Task's record with the
   * Decisions answered on the Task and the one the Thread waits on.
   */
  async forTaskThread(thread: Thread, setup: TaskThreadSetup): Promise<Brief> {
    if (thread.home.kind !== "task") throw new Error(`Thread ${thread.id} is not on a Task.`);
    return taskThreadBrief({
      record: setup.brief,
      continuing: thread.session !== undefined,
      answered: await this.repository.answeredOn(thread.home.taskId),
      open: thread.openDecision,
      memory: await this.memory.forBrief(thread.roleKey, {
        kind: "project",
        projectId: setup.projectId,
      }),
    });
  }

  /** As `forThread`, from the setup the session is about to start with: the Initiative's record. */
  async forInitiativeThread(thread: Thread, setup: InitiativeThreadSetup): Promise<Brief> {
    return initiativeThreadBrief({
      record: setup.record,
      continuing: thread.session !== undefined,
      // An Initiative spans Projects, so it reads the notes that hold for all of them.
      memory: await this.memory.forBrief(thread.roleKey, { kind: "all-projects" }),
      projects: await this.bases.list(),
    });
  }

  /** A new chat Thread's, or the one it continues fresh with from its log so far. */
  private async forChatThread(thread: Thread): Promise<Brief> {
    const projects = await this.bases.list();
    // A chat reads every Project, so it reads every note.
    const memory = await this.memory.forBrief(thread.roleKey, { kind: "every-note", projects });
    if (thread.session === undefined) return newChatThreadBrief(projects, memory);
    const log = await this.repository.messages(thread.id);
    return freshChatThreadBrief({ title: thread.title, log, projects, memory });
  }
}
