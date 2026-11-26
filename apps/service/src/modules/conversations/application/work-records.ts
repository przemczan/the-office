import type { OfficeToolSubject } from "../../engine/index.js";
import { Injectable } from "@nestjs/common";

/**
 * The records of Tasks, Initiatives and Ideas as an Agent reads them; undefined when there is no
 * such one.
 */
export interface WorkRecordSource {
  taskRecord(taskId: string): Promise<string | undefined>;
  /** The Task's title, which a Link card's note links to it by. */
  taskTitle(taskId: string): Promise<string | undefined>;
  /** The title and Project of each of the Tasks there is, by its id, which name a list's Threads. */
  taskSubjects(taskIds: readonly string[]): Promise<ReadonlyMap<string, TaskSubject>>;
  /** The ids of the Task's Attachments, which a Decision on it may name. */
  taskAttachmentIds(taskId: string): Promise<readonly string[]>;
  /**
   * As `taskAttachmentIds`, for a Decision in the Initiative's planning Thread: undefined when the
   * Task isn't one of the Initiative's.
   */
  initiativeTaskAttachmentIds(
    initiativeId: string,
    taskId: string,
  ): Promise<readonly string[] | undefined>;
  /**
   * Whether the Thread is one of the Initiative's planning Threads; every other Thread on it is a
   * shaping Thread.
   */
  isInitiativePlanningThread(initiativeId: string, threadId: string): Promise<boolean>;
  /** The ids of the Initiative's own Attachments, which a Decision on no Task in its Threads may name. */
  initiativeAttachmentIds(initiativeId: string): Promise<readonly string[]>;
  initiativeRecord(initiativeId: string): Promise<string | undefined>;
  /** The Initiative's name, which names a Thread on it. */
  initiativeName(initiativeId: string): Promise<string | undefined>;
  /** The Tasks in the Project, archived ones too, and the Initiatives spanning it, by their ids. */
  projectWork(projectId: string): Promise<ProjectWork>;
  ideaRecord(ideaId: string): Promise<string | undefined>;
  /**
   * Whether the subject is the person's own work (spec 6 › Authority): a Task, Idea or Initiative
   * they created, or a Task they worked a Stage of. False for any other subject.
   */
  isOwnWork(roleKey: string, subject: OfficeToolSubject): Promise<boolean>;
}

/** What names a Thread on a Task in a list: the Task's title and its Project. */
export interface TaskSubject {
  readonly title: string;
  readonly projectId: string;
}

/** The ids of a Project's Tasks and of the Initiatives spanning it. */
export interface ProjectWork {
  readonly taskIds: readonly string[];
  readonly initiativeIds: readonly string[];
}

/**
 * Where the module keeping Tasks, Initiatives and Ideas gives Conversations their records, for the ones the user
 * mentions in a message, the Tasks a Link card is about, the Attachments a Decision names, and the
 * subjects and Projects of the Threads `read_threads` reads. That module calls Conversations to open its Threads, so it registers here
 * instead of being called through a port, as with TaskThreadSetups.
 */
@Injectable()
export class WorkRecords implements WorkRecordSource {
  private source: WorkRecordSource | undefined;

  provide(source: WorkRecordSource): void {
    if (this.source) throw new Error("Work's records come from one module only.");
    this.source = source;
  }

  taskRecord(taskId: string): Promise<string | undefined> {
    return this.registered().taskRecord(taskId);
  }

  taskTitle(taskId: string): Promise<string | undefined> {
    return this.registered().taskTitle(taskId);
  }

  taskSubjects(taskIds: readonly string[]): Promise<ReadonlyMap<string, TaskSubject>> {
    return this.registered().taskSubjects(taskIds);
  }

  taskAttachmentIds(taskId: string): Promise<readonly string[]> {
    return this.registered().taskAttachmentIds(taskId);
  }

  initiativeTaskAttachmentIds(
    initiativeId: string,
    taskId: string,
  ): Promise<readonly string[] | undefined> {
    return this.registered().initiativeTaskAttachmentIds(initiativeId, taskId);
  }

  isInitiativePlanningThread(initiativeId: string, threadId: string): Promise<boolean> {
    return this.registered().isInitiativePlanningThread(initiativeId, threadId);
  }

  initiativeAttachmentIds(initiativeId: string): Promise<readonly string[]> {
    return this.registered().initiativeAttachmentIds(initiativeId);
  }

  initiativeRecord(initiativeId: string): Promise<string | undefined> {
    return this.registered().initiativeRecord(initiativeId);
  }

  initiativeName(initiativeId: string): Promise<string | undefined> {
    return this.registered().initiativeName(initiativeId);
  }

  projectWork(projectId: string): Promise<ProjectWork> {
    return this.registered().projectWork(projectId);
  }

  ideaRecord(ideaId: string): Promise<string | undefined> {
    return this.registered().ideaRecord(ideaId);
  }

  isOwnWork(roleKey: string, subject: OfficeToolSubject): Promise<boolean> {
    return this.registered().isOwnWork(roleKey, subject);
  }

  private registered(): WorkRecordSource {
    if (!this.source) throw new Error("No module gives Work's records.");
    return this.source;
  }
}
