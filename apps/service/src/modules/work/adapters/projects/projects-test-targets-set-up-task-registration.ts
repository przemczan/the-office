import { Injectable, type OnModuleInit } from "@nestjs/common";
import { TestTargetsSetUpTasks } from "../../../projects/index.js";
import { TestTargetsSetUps } from "../../application/test-targets-set-ups.js";

/**
 * Gives Projects a Project's open "Set up test targets" Task made before the page asked in a chat,
 * which its Set up test targets card links instead. Work reads Projects, so Projects can't ask Work
 * directly.
 */
@Injectable()
export class ProjectsTestTargetsSetUpTaskRegistration implements OnModuleInit {
  constructor(
    private readonly registry: TestTargetsSetUpTasks,
    private readonly setUps: TestTargetsSetUps,
  ) {}

  onModuleInit(): void {
    this.registry.register(async (projectId) => {
      const task = await this.setUps.openOf(projectId);
      return task && { id: task.id, title: task.title, state: task.state };
    });
  }
}
