import { Module } from "@nestjs/common";
import { PeopleModule } from "../people/index.js";
import { ThreadsController } from "./adapters/http/threads.controller.js";
import { PostgresThreadRepository } from "./adapters/postgres/postgres-thread-repository.js";
import { ThreadWebEvents } from "./adapters/websocket/thread-web-events.js";
import { ThreadService } from "./application/thread-service.js";
import { ThreadRepository } from "./ports/thread-repository.js";

@Module({
  // A chat is with a person, whose Role card says whether Chat is on.
  imports: [PeopleModule],
  controllers: [ThreadsController],
  providers: [
    { provide: ThreadRepository, useClass: PostgresThreadRepository },
    ThreadService,
    ThreadWebEvents,
  ],
})
export class ConversationsModule {}
