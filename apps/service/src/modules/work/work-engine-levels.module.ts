import { Module } from "@nestjs/common";
import { WorkEngineLevels } from "./adapters/people/work-engine-levels.js";
import { PostgresInitiativeRepository } from "./adapters/postgres/postgres-initiative-repository.js";
import { PostgresTaskRepository } from "./adapters/postgres/postgres-task-repository.js";
import { InitiativeRepository } from "./ports/initiative-repository.js";
import { TaskRepository } from "./ports/task-repository.js";

/**
 * The engines Tasks and Initiatives set, for People's engine cascade (`KnownWorkLevels`), apart
 * from `WorkModule`, which imports the cascade: it needs only the database.
 */
@Module({
  providers: [
    { provide: TaskRepository, useClass: PostgresTaskRepository },
    { provide: InitiativeRepository, useClass: PostgresInitiativeRepository },
    WorkEngineLevels,
  ],
  exports: [WorkEngineLevels],
})
export class WorkEngineLevelsModule {}
