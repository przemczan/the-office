import { Injectable } from "@nestjs/common";
import {
  freshChatThreadBrief,
  newChatThreadBrief,
  taskThreadBrief,
  type Brief,
} from "../domain/brief.js";
import type { Thread } from "../domain/thread.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { TaskThreadSetups, type TaskThreadSetup } from "./task-thread-setups.js";

/** Assembles each new session's Brief from the record, with no model call (spec §2.5). */
@Injectable()
export class Briefs {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly bases: ProjectBases,
    private readonly taskThreads: TaskThreadSetups,
  ) {}

  /** The Brief of the Thread's next session. Read before the message it answers is logged. */
  async forThread(thread: Thread): Promise<Brief> {
    if (thread.home.kind === "chat") return this.forChatThread(thread);
    const setup = await this.taskThreads.of({
      threadId: thread.id,
      taskId: thread.home.taskId,
      roleKey: thread.roleKey,
    });
    return this.forTaskThread(thread, setup);
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
    });
  }

  /** A new chat Thread's, or the one it continues fresh with from its log so far. */
  private async forChatThread(thread: Thread): Promise<Brief> {
    const projects = await this.bases.list();
    if (thread.session === undefined) return newChatThreadBrief(projects);
    const log = await this.repository.messages(thread.id);
    return freshChatThreadBrief({ title: thread.title, log, projects });
  }
}
