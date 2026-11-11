import { Injectable, type OnModuleInit } from "@nestjs/common";
import { WorkRecords, type WorkRecordSource } from "../../../conversations/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaRecords } from "../../application/idea-records.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import { IdeaNotFound } from "../../domain/idea-not-found.js";
import { InitiativeNotFound } from "../../domain/initiative-not-found.js";
import { TaskNotFound } from "../../domain/task-not-found.js";

/**
 * Gives Conversations the records of the Tasks, Initiatives and Ideas the user mentions in a chat,
 * worded as `read_task`, `read_initiative` and `read_idea` word them, with their linked records, the
 * titles of the Tasks a Link card is about, and the Attachments of a Task a Decision may name,
 * which tell too whether a Decision in an Initiative's planning Thread names one of its Tasks.
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
  ) {}

  onModuleInit(): void {
    this.records.provide(this);
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

  async initiativeRecord(initiativeId: string): Promise<string | undefined> {
    try {
      return await this.initiatives.recordText(initiativeId);
    } catch (error) {
      if (error instanceof InitiativeNotFound) return undefined;
      throw error;
    }
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
