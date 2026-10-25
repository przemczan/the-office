import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseFilters } from "@nestjs/common";
import {
  threadTitleSchema,
  type Message as MessageResponse,
  type Thread as ThreadResponse,
  type ThreadTitle,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { ThreadService } from "../../application/thread-service.js";
import type { Message } from "../../domain/message.js";
import type { Thread } from "../../domain/thread.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

@Controller()
@UseFilters(ThreadRefusalsFilter)
export class ThreadsController {
  constructor(private readonly threads: ThreadService) {}

  @Get("chats/:roleKey/threads")
  async listInChat(@Param("roleKey") roleKey: string): Promise<ThreadResponse[]> {
    return (await this.threads.listInChat(roleKey)).map(toThreadResponse);
  }

  /** A fresh Thread in the person's chat. */
  @Post("chats/:roleKey/threads")
  async startInChat(@Param("roleKey") roleKey: string): Promise<ThreadResponse> {
    return toThreadResponse(await this.threads.startInChat(roleKey));
  }

  @Get("threads/:id")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<ThreadResponse> {
    return toThreadResponse(await this.threads.read(id));
  }

  @Put("threads/:id/title")
  async rename(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(threadTitleSchema)) { title }: ThreadTitle,
  ): Promise<ThreadResponse> {
    return toThreadResponse(await this.threads.rename(id, title));
  }

  @Get("threads/:id/messages")
  async messages(@Param("id", ParseUUIDPipe) id: string): Promise<MessageResponse[]> {
    return (await this.threads.messages(id)).map(toMessageResponse);
  }
}

function toThreadResponse(thread: Thread): ThreadResponse {
  return {
    id: thread.id,
    home: thread.home,
    roleKey: thread.roleKey,
    title: thread.title ?? null,
    state: thread.state,
    tokens: { ...thread.tokens },
    startedAt: thread.startedAt.toISOString(),
  };
}

function toMessageResponse({ threadId: _threadId, at, ...message }: Message): MessageResponse {
  return { ...message, at: at.toISOString() };
}
