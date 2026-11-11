import { Injectable } from "@nestjs/common";
import {
  freshChatThreadBrief,
  freshPersonsThreadBrief,
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
import { taskThreadRequest, TaskThreadSetups, type TaskThreadSetup } from "./task-thread-setups.js";

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
          await this.taskThreads.of(taskThreadRequest(thread, home.taskId)),
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
   * Decisions answered on the Task and the one the Thread waits on. A later session of a person's
   * Thread has no record: its Brief is the Context policy's, from the Thread's own log.
   */
  async forTaskThread(thread: Thread, setup: TaskThreadSetup): Promise<Brief> {
    if (thread.home.kind !== "task") throw new Error(`Thread ${thread.id} is not on a Task.`);
    const memory = await this.memory.forBrief(thread.roleKey, {
      kind: "project",
      projectId: setup.projectId,
    });
    if (setup.brief === undefined) {
      const log = await this.repository.messages(thread.id);
      return freshPersonsThreadBrief({ title: thread.title, log, memory });
    }
    return taskThreadBrief({
      record: setup.brief,
      continuing: thread.session !== undefined,
      answered: await this.repository.answeredOn(thread.home.taskId),
      // A Thread on a Task waits on one Decision at most.
      open: thread.openDecisions[0],
      memory,
    });
  }

  /** What the first session of the person's Thread would start on, before the Thread is opened. */
  async forPersonsFirstSession(taskId: string, roleKey: string): Promise<Brief> {
    const setup = await this.taskThreads.of({
      taskId,
      roleKey,
      personsThread: true,
      firstSession: true,
    });
    if (setup.brief === undefined) throw new Error(`Task ${taskId} gave no first session's Brief.`);
    return taskThreadBrief({
      record: setup.brief,
      continuing: false,
      answered: await this.repository.answeredOn(taskId),
      open: undefined,
      memory: await this.memory.forBrief(roleKey, { kind: "project", projectId: setup.projectId }),
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
