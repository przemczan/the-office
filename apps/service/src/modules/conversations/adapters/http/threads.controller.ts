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
import { ThreadContexts } from "../../application/thread-contexts.js";
import { ThreadRunner } from "../../application/thread-runner.js";
import { ThreadService } from "../../application/thread-service.js";
import type { ContextDecision } from "../../domain/context-policy.js";
import type { Message } from "../../domain/message.js";
import type { Thread } from "../../domain/thread.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

@Controller()
@UseFilters(ThreadRefusalsFilter)
export class ThreadsController {
  constructor(
    private readonly threads: ThreadService,
    private readonly contexts: ThreadContexts,
    private readonly runner: ThreadRunner,
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

  @Get("threads/:id/messages")
  async messages(@Param("id", ParseUUIDPipe) id: string): Promise<MessageResponse[]> {
    return (await this.threads.messages(id)).map(toMessageResponse);
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

function toThreadResponse(thread: Thread, context: ContextDecision): ThreadResponse {
  return {
    id: thread.id,
    home: thread.home,
    roleKey: thread.roleKey,
    title: thread.title ?? null,
    state: thread.state,
    tokens: { ...thread.tokens },
    context: {
      move: context.move,
      reason: context.reason,
      cacheWarm: context.cacheWarm,
      contextTokens: context.contextTokens,
      briefTokens: context.briefTokens ?? null,
      alternatives: context.alternatives.map(({ override, tokens }) => ({ override, tokens })),
      override: thread.override ?? null,
    },
    startedAt: thread.startedAt.toISOString(),
  };
}

function toMessageResponse({ threadId: _threadId, at, ...message }: Message): MessageResponse {
  const fields = { ...message, at: at.toISOString() };
  return fields.kind === "context"
    ? { ...fields, briefTokens: fields.briefTokens ?? null }
    : fields;
}
