import { Injectable } from "@nestjs/common";
import { onceByKey } from "../../../platform/database/fan-out.js";
import { KnowledgeBase } from "../../../platform/knowledge-base/knowledge-base.js";
import { PromptTemplates, type PromptTexts } from "../../prompt-templates/index.js";
import {
  freshChatThreadBrief,
  freshPersonsThreadBrief,
  initiativeThreadBrief,
  newChatThreadBrief,
  taskThreadBrief,
  withKnowledgeBase,
  type Brief,
} from "../domain/brief.js";
import { BRIEF_TEMPLATES } from "../domain/brief-templates.js";
import type { Thread } from "../domain/thread.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { InitiativeThreadSetups, type InitiativeThreadSetup } from "./initiative-thread-setups.js";
import { SessionMemory } from "./session-memory.js";
import { ThreadImages } from "./thread-images.js";
import { taskThreadRequest, TaskThreadSetups, type TaskThreadSetup } from "./task-thread-setups.js";

/**
 * Assembles each new session's Brief from the record, with no model call (spec §2.5), in the Brief
 * templates' texts as they are when it is assembled.
 */
@Injectable()
export class Briefs {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly bases: ProjectBases,
    private readonly taskThreads: TaskThreadSetups,
    private readonly initiativeThreads: InitiativeThreadSetups,
    private readonly memory: SessionMemory,
    private readonly images: ThreadImages,
    private readonly promptTemplates: PromptTemplates,
    private readonly knowledgeBase: KnowledgeBase,
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
    return this.taskThreadBriefing()(thread, setup);
  }

  /**
   * `forTaskThread` for any number of Threads on Tasks, reading what their Briefs share once: the
   * templates' texts, each Task's answered Decisions and each person's Memory in each Project.
   * Only a later session of a person's Thread reads its own log.
   */
  taskThreadBriefing(): (thread: Thread, setup: TaskThreadSetup) => Promise<Brief> {
    let prompts: Promise<PromptTexts> | undefined;
    const answeredOn = onceByKey((taskId: string) => this.repository.answeredOn(taskId));
    const memoryOf = onceByKey(({ roleKey, projectId }: { roleKey: string; projectId: string }) =>
      this.memory.forBrief(roleKey, { kind: "project", projectId }),
    );
    return async (thread, setup) => {
      const { home } = thread;
      if (home.kind !== "task") throw new Error(`Thread ${thread.id} is not on a Task.`);
      const texts = await (prompts ??= this.texts());
      const memory = await memoryOf({ roleKey: thread.roleKey, projectId: setup.projectId });
      if (setup.brief === undefined) {
        const log = await this.repository.messages(thread.id);
        const removedImages = await this.images.removedIn(log);
        return this.led(
          freshPersonsThreadBrief(texts, { title: thread.title, log, removedImages, memory }),
        );
      }
      return this.led(
        taskThreadBrief(texts, {
          record: setup.brief,
          continuing: thread.session !== undefined,
          answered: await answeredOn(home.taskId),
          // A Thread on a Task waits on one Decision at most.
          open: thread.openDecisions[0],
          memory,
        }),
      );
    };
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
    return this.led(
      taskThreadBrief(await this.texts(), {
        record: setup.brief,
        continuing: false,
        answered: await this.repository.answeredOn(taskId),
        open: undefined,
        memory: await this.memory.forBrief(roleKey, {
          kind: "project",
          projectId: setup.projectId,
        }),
      }),
    );
  }

  /**
   * As `forThread`, from the setup the session is about to start with: the Initiative's record, and
   * the Decision on no Task the Thread waits on.
   */
  async forInitiativeThread(thread: Thread, setup: InitiativeThreadSetup): Promise<Brief> {
    return this.led(
      initiativeThreadBrief(await this.texts(), {
        // A Thread on an Initiative waits on one Decision on no Task at most.
        open: thread.openDecisions.find(({ taskId }) => taskId === undefined),
        record: setup.record,
        continuing: thread.session !== undefined,
        // An Initiative spans Projects, so it reads the notes that hold for all of them.
        memory: await this.memory.forBrief(thread.roleKey, { kind: "all-projects" }),
        projects: await (setup.branchReads === undefined
          ? this.bases.list()
          : this.bases.listOnInitiative(setup.branchReads)),
      }),
    );
  }

  /** A new chat Thread's, or the one it continues fresh with from its log so far. */
  private async forChatThread(thread: Thread): Promise<Brief> {
    const prompts = await this.texts();
    const projects = await this.bases.list();
    // A chat reads every Project, so it reads every note.
    const memory = await this.memory.forBrief(thread.roleKey, { kind: "every-note", projects });
    if (thread.session === undefined)
      return this.led(newChatThreadBrief(prompts, projects, memory));
    const log = await this.repository.messages(thread.id);
    const removedImages = await this.images.removedIn(log);
    return this.led(
      freshChatThreadBrief(prompts, { title: thread.title, log, removedImages, projects, memory }),
    );
  }

  /** Every session's Brief names the knowledge base, which it reads about The Office itself. */
  private led(brief: Brief): Brief {
    return withKnowledgeBase(brief, this.knowledgeBase.index);
  }

  private texts(): Promise<PromptTexts> {
    return this.promptTemplates.textsOf(BRIEF_TEMPLATES);
  }
}
