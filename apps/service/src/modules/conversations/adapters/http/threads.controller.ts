import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseFilters,
} from "@nestjs/common";
import {
  contextOverrideChoiceSchema,
  newMessageSchema,
  threadTitleSchema,
  type ContextOverrideChoice,
  type Message as MessageResponse,
  type NewMessage,
  type Thread as ThreadResponse,
  type ThreadTitle,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { DecisionService } from "../../application/decision-service.js";
import { ThreadContexts } from "../../application/thread-contexts.js";
import { ThreadRunner } from "../../application/thread-runner.js";
import { ThreadService } from "../../application/thread-service.js";
import type { Thread } from "../../domain/thread.js";
import { toMessageResponse, toThreadResponse } from "./conversation-responses.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

@Controller()
@UseFilters(ThreadRefusalsFilter)
export class ThreadsController {
  constructor(
    private readonly threads: ThreadService,
    private readonly contexts: ThreadContexts,
    private readonly runner: ThreadRunner,
    private readonly decisions: DecisionService,
  ) {}

  @Get("chats/:roleKey/threads")
  async listInChat(@Param("roleKey") roleKey: string): Promise<ThreadResponse[]> {
    const threads = await this.threads.listInChat(roleKey);
    return Promise.all(threads.map((thread) => this.toResponse(thread)));
  }

  /** A fresh Thread in the person's chat. */
  @Post("chats/:roleKey/threads")
  async startInChat(@Param("roleKey") roleKey: string): Promise<ThreadResponse> {
    return this.toResponse(await this.threads.startInChat(roleKey));
  }

  @Get("tasks/:taskId/threads")
  async listOnTask(@Param("taskId", ParseUUIDPipe) taskId: string): Promise<ThreadResponse[]> {
    const threads = await this.threads.listOnTask(taskId);
    return Promise.all(threads.map((thread) => this.toResponse(thread)));
  }

  /** The person's Threads on Tasks, the newest first: a person's Work tab lists those Tasks. */
  @Get("roles/:roleKey/task-threads")
  async listOnTasksWith(@Param("roleKey") roleKey: string): Promise<ThreadResponse[]> {
    const threads = await this.threads.listOnTasksWith(roleKey);
    return Promise.all(threads.map((thread) => this.toResponse(thread)));
  }

  @Get("threads/:id")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<ThreadResponse> {
    return this.toResponse(await this.threads.read(id));
  }

  @Put("threads/:id/title")
  async rename(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(threadTitleSchema)) { title }: ThreadTitle,
  ): Promise<ThreadResponse> {
    return this.toResponse(await this.threads.rename(id, title));
  }

  @Put("threads/:id/context-override")
  async chooseOverride(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(contextOverrideChoiceSchema)) { override }: ContextOverrideChoice,
  ): Promise<ThreadResponse> {
    return this.toResponse(await this.threads.chooseOverride(id, override ?? undefined));
  }

  /** The log, with each Decision's card and answer showing the Decision as it is now. */
  @Get("threads/:id/messages")
  async messages(@Param("id", ParseUUIDPipe) id: string): Promise<MessageResponse[]> {
    const messages = await this.threads.messages(id);
    const decisions = await this.decisions.listInThread(id);
    const byId = new Map(decisions.map((decision) => [decision.id, decision]));
    return messages.map((message) => toMessageResponse(message, byId));
  }

  /** The user's message; the person's answer comes into the log as it is written. */
  @Post("threads/:id/messages")
  @HttpCode(HttpStatus.ACCEPTED)
  async send(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(newMessageSchema)) { text }: NewMessage,
  ): Promise<ThreadResponse> {
    return this.toResponse(await this.runner.send(id, text));
  }

  private async toResponse(thread: Thread): Promise<ThreadResponse> {
    return toThreadResponse(thread, await this.contexts.of(thread));
  }
}
