import type { OfficeToolSubject } from "../../../engine/index.js";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  WorkRecords,
  type ProjectWork,
  type TaskSubject,
  type WorkRecordSource,
} from "../../../conversations/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaRecords } from "../../application/idea-records.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import { IdeaNotFound } from "../../domain/idea-not-found.js";
import { planningThreadOf, type Initiative } from "../../domain/initiative.js";
import { InitiativeNotFound } from "../../domain/initiative-not-found.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import type { Author } from "../../domain/author.js";
import { InitiativeThreads } from "../../ports/initiative-threads.js";
import { TaskThreads } from "../../ports/task-threads.js";

/**
 * Gives Conversations the records of the Tasks, Initiatives and Ideas the user mentions in a chat,
 * worded as `read_task`, `read_initiative` and `read_idea` word them, with their linked records, the
 * titles of the Tasks a Link card is about, and the Attachments of a Task a Decision may name,
 * which tell too whether a Decision in an Initiative's planning Thread names one of its Tasks, and
 * the names and Projects `read_threads` reads Threads on Tasks and Initiatives by.
 */
@Injectable()
export class MentionedWorkRecords implements WorkRecordSource, OnModuleInit {
  constructor(
    private readonly records: WorkRecords,
    private readonly tasks: TaskService,
    private readonly taskRecords: TaskRecords,
    private readonly initiatives: InitiativeService,
    private readonly ideaRecords: IdeaRecords,
    private readonly attachments: AttachmentService,
    private readonly ideas: IdeaService,
    private readonly taskThreads: TaskThreads,
    private readonly initiativeThreads: InitiativeThreads,
  ) {}

  onModuleInit(): void {
    this.records.provide(this);
  }

  async isOwnWork(roleKey: string, { kind, id }: OfficeToolSubject): Promise<boolean> {
    try {
      switch (kind) {
        case "task":
          return (
            createdBy(roleKey, (await this.tasks.read(id)).createdBy) ||
            (await this.taskThreads.titlesOnTasksWith(roleKey)).some(({ taskId }) => taskId === id)
          );
        case "initiative": {
          const initiative = await this.initiatives.read(id);
          return (
            createdBy(roleKey, initiative.createdBy) || (await this.shapes(roleKey, initiative))
          );
        }
        case "idea":
          return createdBy(roleKey, (await this.ideas.read(id)).capturedBy);
        default:
          return false;
      }
    } catch (error) {
      if (
        error instanceof TaskNotFound ||
        error instanceof InitiativeNotFound ||
        error instanceof IdeaNotFound
      ) {
        return false;
      }
      throw error;
    }
  }

  /** Whether the person has a shaping Thread on the Initiative: one of theirs, but a planning one. */
  private async shapes(roleKey: string, initiative: Initiative): Promise<boolean> {
    const threadIds = await this.initiativeThreads.idsOnInitiativeWith(initiative.id, roleKey);
    return threadIds.some((threadId) => planningThreadOf(initiative, threadId) === undefined);
  }

  async taskRecord(taskId: string): Promise<string | undefined> {
    try {
      return await this.taskRecords.recordText(taskId);
    } catch (error) {
      if (error instanceof TaskNotFound) return undefined;
      throw error;
    }
  }

  async taskTitle(taskId: string): Promise<string | undefined> {
    try {
      return (await this.tasks.read(taskId)).title;
    } catch (error) {
      if (error instanceof TaskNotFound) return undefined;
      throw error;
    }
  }

  async taskSubjects(taskIds: readonly string[]): Promise<ReadonlyMap<string, TaskSubject>> {
    const tasks = await this.tasks.findAll(taskIds);
    return new Map(tasks.map(({ id, title, projectId }) => [id, { title, projectId }]));
  }

  async taskAttachmentIds(taskId: string): Promise<readonly string[]> {
    const attachments = await this.attachments.listOf({ kind: "task", taskId });
    return attachments.map(({ id }) => id);
  }

  async initiativeTaskAttachmentIds(
    initiativeId: string,
    taskId: string,
  ): Promise<readonly string[] | undefined> {
    try {
      const task = await this.tasks.read(taskId);
      if (task.initiativeId !== initiativeId) return undefined;
    } catch (error) {
      if (error instanceof TaskNotFound) return undefined;
      throw error;
    }
    return this.taskAttachmentIds(taskId);
  }

  async isInitiativePlanningThread(initiativeId: string, threadId: string): Promise<boolean> {
    try {
      return planningThreadOf(await this.initiatives.read(initiativeId), threadId) !== undefined;
    } catch (error) {
      if (error instanceof InitiativeNotFound) return false;
      throw error;
    }
  }

  async initiativeAttachmentIds(initiativeId: string): Promise<readonly string[]> {
    try {
      const attachments = await this.attachments.listOf({ kind: "initiative", initiativeId });
      return attachments.map(({ id }) => id);
    } catch (error) {
      if (error instanceof InitiativeNotFound) return [];
      throw error;
    }
  }

  async initiativeRecord(initiativeId: string): Promise<string | undefined> {
    try {
      return await this.initiatives.recordText(initiativeId);
    } catch (error) {
      if (error instanceof InitiativeNotFound) return undefined;
      throw error;
    }
  }

  async initiativeName(initiativeId: string): Promise<string | undefined> {
    try {
      return (await this.initiatives.read(initiativeId)).name;
    } catch (error) {
      if (error instanceof InitiativeNotFound) return undefined;
      throw error;
    }
  }

  async projectWork(projectId: string): Promise<ProjectWork> {
    const tasks = await this.tasks.inProject(projectId);
    return {
      taskIds: tasks.map(({ id }) => id),
      initiativeIds: [
        ...new Set(tasks.flatMap(({ initiativeId }) => (initiativeId ? [initiativeId] : []))),
      ],
    };
  }

  async ideaRecord(ideaId: string): Promise<string | undefined> {
    try {
      return await this.ideaRecords.recordText(ideaId);
    } catch (error) {
      if (error instanceof IdeaNotFound) return undefined;
      throw error;
    }
  }
}

function createdBy(roleKey: string, author: Author): boolean {
  return author.kind === "person" && author.roleKey === roleKey;
}
