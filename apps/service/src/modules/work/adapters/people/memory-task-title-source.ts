import { Injectable, type OnModuleInit } from "@nestjs/common";
import { MemoryTaskTitles, type MemoryTaskTitleSource } from "../../../people/index.js";
import { TaskService } from "../../application/task-service.js";

/**
 * Gives People the titles of the Tasks Memory notes were written on, archived ones too, all in one
 * read, which the Memory tab names the notes by.
 */
@Injectable()
export class MemoryTaskTitleSourceFromWork implements MemoryTaskTitleSource, OnModuleInit {
  constructor(
    private readonly titles: MemoryTaskTitles,
    private readonly tasks: TaskService,
  ) {}

  onModuleInit(): void {
    this.titles.provide(this);
  }

  async titlesOf(taskIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const tasks = await this.tasks.findAll(taskIds);
    return new Map(tasks.map(({ id, title }) => [id, title]));
  }
}
