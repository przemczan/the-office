import { Injectable, type OnModuleInit } from "@nestjs/common";
import { WorkRecords, type WorkRecordSource } from "../../../conversations/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaService } from "../../application/idea-service.js";
import { TaskService } from "../../application/task-service.js";
import { IdeaNotFound } from "../../domain/idea-not-found.js";
import { ideaRecordText, taskRecordText } from "../../domain/record-words.js";
import { TaskNotFound } from "../../domain/task-not-found.js";

/**
 * Gives Conversations the records of the Tasks and Ideas the user mentions in a chat, worded as
 * `read_task` and `read_idea` word them, and the titles of the Tasks a Link card is about.
 */
@Injectable()
export class MentionedWorkRecords implements WorkRecordSource, OnModuleInit {
  constructor(
    private readonly records: WorkRecords,
    private readonly tasks: TaskService,
    private readonly ideas: IdeaService,
    private readonly attachments: AttachmentService,
  ) {}

  onModuleInit(): void {
    this.records.provide(this);
  }

  async taskRecord(taskId: string): Promise<string | undefined> {
    try {
      const task = await this.tasks.read(taskId);
      const attachments = await this.attachments.listOf({ kind: "task", taskId });
      return taskRecordText(task, attachments, await this.tasks.blockersOf(task));
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

  async ideaRecord(ideaId: string): Promise<string | undefined> {
    try {
      const idea = await this.ideas.read(ideaId);
      return ideaRecordText(idea, await this.attachments.listOf({ kind: "idea", ideaId }));
    } catch (error) {
      if (error instanceof IdeaNotFound) return undefined;
      throw error;
    }
  }
}
