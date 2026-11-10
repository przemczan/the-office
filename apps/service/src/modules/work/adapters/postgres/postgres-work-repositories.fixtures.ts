import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { THE_USER } from "../../domain/author.js";
import { shapeIdeaIntoInitiative } from "../../domain/idea-changes.js";
import { boardOrder, orderAfter } from "../../domain/manual-order.js";
import type { Task } from "../../domain/task.js";
import { createTask } from "../../domain/task-changes.js";
import { anIdea } from "../../domain/work.fixtures.js";
import { PostgresAttachmentRepository } from "./postgres-attachment-repository.js";
import { PostgresIdeaRepository } from "./postgres-idea-repository.js";
import { PostgresInitiativeRepository } from "./postgres-initiative-repository.js";
import { PostgresTaskRepository } from "./postgres-task-repository.js";

/** Work's Postgres repositories on the test database. */
export interface WorkRepositories {
  readonly app: INestApplication;
  readonly ideas: PostgresIdeaRepository;
  readonly tasks: PostgresTaskRepository;
  readonly attachments: PostgresAttachmentRepository;
  readonly initiatives: PostgresInitiativeRepository;
  readonly database: Database;
}

export async function startWorkRepositories(): Promise<WorkRepositories> {
  const { app } = await startTestApplication({
    database: true,
    providers: [
      PostgresIdeaRepository,
      PostgresTaskRepository,
      PostgresAttachmentRepository,
      PostgresInitiativeRepository,
    ],
  });
  return {
    app,
    ideas: app.get(PostgresIdeaRepository),
    initiatives: app.get(PostgresInitiativeRepository),
    tasks: app.get(PostgresTaskRepository),
    attachments: app.get(PostgresAttachmentRepository),
    database: app.get<Database>(DATABASE),
  };
}

/** A Project id of the test's own: every test file shares the database. */
export function aProjectId(): string {
  return `project-${randomUUID()}`;
}

/** The records the repositories' tests share, on the repositories `current` gives. */
export function workRecords(current: () => Pick<WorkRepositories, "ideas" | "tasks">) {
  /** Creates a Task in the Project, last on the board. */
  async function createdTask(projectId: string, fields: Partial<Task> = {}): Promise<Task> {
    const { task } = await current().tasks.create((takenOrders) =>
      createTask(
        randomUUID(),
        {
          title: fields.title ?? "A Task",
          description: fields.description,
          projectId,
          priority: fields.priority ?? "normal",
        },
        {
          pipelineId: "full",
          order: orderAfter(takenOrders),
          originIdeaId: undefined,
          initiativeId: undefined,
          createdBy: THE_USER,
        },
        new Date("2026-10-25T10:00:00.000Z"),
      ),
    );
    return task;
  }

  /** An Initiative being shaped, from an Idea of its own. */
  async function anInitiativeId(): Promise<string> {
    const initiativeId = randomUUID();
    const idea = anIdea({ id: randomUUID() });
    await current().ideas.add(idea);
    await current().ideas.shapeIntoInitiative(idea.id, (stored) => ({
      ...shapeIdeaIntoInitiative(stored, initiativeId, THE_USER, new Date()),
      moves: [],
    }));
    return initiativeId;
  }

  /** The Project's Tasks as the board shows them. */
  async function boardOf(projectId: string): Promise<string[]> {
    return (await current().tasks.list())
      .filter((task) => task.projectId === projectId)
      .toSorted(boardOrder)
      .map((task) => task.title);
  }

  return { createdTask, anInitiativeId, boardOf };
}
