import {
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type ModuleMetadata,
  type NestModule,
  type Type,
} from "@nestjs/common";
import { uploadBody } from "../../platform/http/upload-body.js";
import { FilesystemAttachmentFiles } from "./adapters/filesystem/filesystem-attachment-files.js";
import {
  ATTACHMENT_UPLOAD_ROUTES,
  AttachmentsController,
} from "./adapters/http/attachments.controller.js";
import { IdeasController } from "./adapters/http/ideas.controller.js";
import { TasksController } from "./adapters/http/tasks.controller.js";
import { PostgresAttachmentRepository } from "./adapters/postgres/postgres-attachment-repository.js";
import { PostgresIdeaRepository } from "./adapters/postgres/postgres-idea-repository.js";
import { PostgresTaskRepository } from "./adapters/postgres/postgres-task-repository.js";
import { WorkWebEvents } from "./adapters/websocket/work-web-events.js";
import { AttachmentService } from "./application/attachment-service.js";
import { IdeaService } from "./application/idea-service.js";
import { TaskService } from "./application/task-service.js";
import { ATTACHMENT_SIZE_LIMIT } from "./domain/attachment.js";
import { AttachmentFiles } from "./ports/attachment-files.js";
import { AttachmentRepository } from "./ports/attachment-repository.js";
import { IdeaRepository } from "./ports/idea-repository.js";
import { KnownProjects } from "./ports/known-projects.js";
import { TaskRepository } from "./ports/task-repository.js";

export interface WorkModuleOptions {
  /** The modules that provide `knownProjects`. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly knownProjects: Type<KnownProjects>;
}

@Module({})
export class WorkModule implements NestModule {
  static register({ imports, knownProjects }: WorkModuleOptions): DynamicModule {
    return {
      module: WorkModule,
      imports,
      controllers: [IdeasController, TasksController, AttachmentsController],
      providers: [
        { provide: IdeaRepository, useClass: PostgresIdeaRepository },
        { provide: TaskRepository, useClass: PostgresTaskRepository },
        { provide: AttachmentRepository, useClass: PostgresAttachmentRepository },
        { provide: AttachmentFiles, useClass: FilesystemAttachmentFiles },
        { provide: KnownProjects, useExisting: knownProjects },
        IdeaService,
        TaskService,
        AttachmentService,
        WorkWebEvents,
      ],
      exports: [IdeaService, TaskService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(uploadBody(ATTACHMENT_SIZE_LIMIT))
      .forRoutes(...ATTACHMENT_UPLOAD_ROUTES.map((path) => ({ path, method: RequestMethod.POST })));
  }
}
