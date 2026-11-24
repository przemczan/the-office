import { Injectable } from "@nestjs/common";
import { RoleCards } from "../../people/index.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Consultations } from "./consultations.js";

/** A Consultation on a Task, as a module acting for its Consultant's session needs it. */
export interface ConsultationOnTask {
  readonly taskId: string;
  /** The Decision the Consultant answers, which the Office lines about the Consultation name. */
  readonly decisionId: string;
  /** The Thread that asked, which waits on the Decision, such as a Stage Thread. */
  readonly askingThreadId: string;
  readonly consultant: {
    readonly name: string;
    readonly roleTitle: string;
  };
  /** The Consultant's card has the Run environment capability now. */
  readonly runEnvironment: boolean;
}

/**
 * What another module needs of a Consultation on a Task to act for its Consultant (spec §6), such
 * as Pipelines writing the run environment definition into the Task's worktree: who asks and who
 * answers, and The Office's lines about it in the Consultation or the asking Thread.
 */
@Injectable()
export class ConsultationsOnTasks {
  constructor(
    private readonly threads: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly consultations: Consultations,
  ) {}

  /**
   * The Consultation on a Task whose session this is; undefined for any other session, a
   * Consultation in a chat included, or when nobody fills the Consultant's Role now.
   */
  async consultationOnTask(sessionId: string): Promise<ConsultationOnTask | undefined> {
    const thread = await this.threads.findBySession(sessionId);
    if (!thread?.consultation || thread.home.kind !== "task") return undefined;
    const role = await this.roleCards.find(thread.roleKey);
    if (!role) return undefined;
    const { askerThreadId, decisionId } = thread.consultation;
    return {
      taskId: thread.home.taskId,
      decisionId,
      askingThreadId: askerThreadId,
      consultant: { name: role.card.name, roleTitle: role.card.title },
      runEnvironment: role.card.capabilities.runEnvironment,
    };
  }

  /**
   * The Office's line about the Consultation of `decisionId` in `threadId`, the Consultation's or
   * its asking Thread, as a Consultation's lines are kept ("consultation-line"): the Thread's log
   * shows it, and a Stage Thread's Stage history with it.
   */
  async logOfficeLine(threadId: string, decisionId: string, text: string): Promise<void> {
    await this.consultations.logLine(threadId, decisionId, text);
  }
}
