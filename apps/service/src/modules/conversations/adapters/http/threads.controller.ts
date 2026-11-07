import {
  Body,
  Controller,
  Delete,
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
  recordLinksIn,
  threadSeenSchema,
  threadTitleSchema,
  type ChatActivity as ChatActivityResponse,
  type RecordLink,
  type ContextOverrideChoice,
  type Message as MessageResponse,
  type NewMessage,
  type PeopleWorking as PeopleWorkingResponse,
  type Thread as ThreadResponse,
  type ThreadSeen,
  type ThreadTitle,
  type FirstBrief,
  type TaskConversation as TaskConversationResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { AllowChanges } from "../../application/allow-changes.js";
import { ChatActivity } from "../../application/chat-activity.js";
import { DecisionService } from "../../application/decision-service.js";
import { LinkCards } from "../../application/link-cards.js";
import { ProposalService } from "../../application/proposal-service.js";
import { TaskConversations } from "../../application/task-conversations.js";
import { ThreadContexts } from "../../application/thread-contexts.js";
import { ThreadRunner } from "../../application/thread-runner.js";
import { ThreadService } from "../../application/thread-service.js";
import type { Mention } from "../../domain/mention.js";
import type { Thread } from "../../domain/thread.js";
import {
  toChatActivityResponse,
  toMessageResponse,
  toPeopleWorkingResponse,
  toTaskConversationResponse,
  toThreadResponse,
} from "./conversation-responses.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

@Controller()
@UseFilters(ThreadRefusalsFilter)
export class ThreadsController {
  constructor(
    private readonly threads: ThreadService,
    private readonly contexts: ThreadContexts,
    private readonly runner: ThreadRunner,
    private readonly decisions: DecisionService,
    private readonly proposals: ProposalService,
    private readonly linkCards: LinkCards,
    private readonly allowChanges: AllowChanges,
    private readonly chatActivity: ChatActivity,
    private readonly taskConversations: TaskConversations,
  ) {}

  /** Where each person's chat stands, for the Chat button and the person picker. */
  @Get("chats/activity")
  async activityInChats(): Promise<ChatActivityResponse> {
    return toChatActivityResponse(await this.chatActivity.ofPeople());
  }

  /** Who is working on each Task now, for the marks on the board's cards. */
  @Get("people-working")
  async peopleWorking(): Promise<PeopleWorkingResponse> {
    return toPeopleWorkingResponse(await this.taskConversations.peopleWorking());
  }

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

  /** Who has a tab in the Task's conversation, each with their Thread and their Consultations. */
  @Get("tasks/:taskId/conversation")
  async conversation(
    @Param("taskId", ParseUUIDPipe) taskId: string,
  ): Promise<TaskConversationResponse> {
    return toTaskConversationResponse(await this.taskConversations.tabs(taskId));
  }

  /** What a tab with no Thread says the first message would start on; looking opens nothing. */
  @Get("tasks/:taskId/conversation/:roleKey/brief")
  async firstBrief(
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Param("roleKey") roleKey: string,
  ): Promise<FirstBrief> {
    return { tokens: await this.taskConversations.firstBriefTokens(taskId, roleKey) };
  }

  /** The person's one Thread on the Task, opened the first time their tab asks for it. */
  @Post("tasks/:taskId/conversation/:roleKey/thread")
  async openPersonsThread(
    @Param("taskId", ParseUUIDPipe) taskId: string,
    @Param("roleKey") roleKey: string,
  ): Promise<ThreadResponse> {
    return this.toResponse(await this.taskConversations.openThread(taskId, roleKey));
  }

  @Get("initiatives/:initiativeId/threads")
  async listOnInitiative(
    @Param("initiativeId", ParseUUIDPipe) initiativeId: string,
  ): Promise<ThreadResponse[]> {
    const threads = await this.threads.listOnInitiative(initiativeId);
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

  /**
   * Allows changes in the Caretaker's Thread, as the user confirmed (spec §2.4): its session ends,
   * and the next message starts one reaching the workstation but secrets.
   */
  @Put("threads/:id/allow-changes")
  async allow(@Param("id", ParseUUIDPipe) id: string): Promise<ThreadResponse> {
    return this.toResponse(await this.allowChanges.allow(id));
  }

  /** Switches changes off in the Thread: its session ends, and the Caretaker only reads again. */
  @Delete("threads/:id/allow-changes")
  async switchOff(@Param("id", ParseUUIDPipe) id: string): Promise<ThreadResponse> {
    return this.toResponse(await this.allowChanges.switchOff(id));
  }

  /** The user has seen the chat Thread up to the message (spec §2.4). */
  @Put("threads/:id/seen")
  async markSeen(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(threadSeenSchema)) { messageId }: ThreadSeen,
  ): Promise<ThreadResponse> {
    return this.toResponse(await this.chatActivity.markSeen(id, messageId));
  }

  /**
   * The log, with each Decision's card and answer showing the Decision as it is now, each
   * Proposal's card the Proposal, and each Link card whether its person was let go.
   */
  @Get("threads/:id/messages")
  async messages(@Param("id", ParseUUIDPipe) id: string): Promise<MessageResponse[]> {
    const [messages, decisions, proposals] = await Promise.all([
      this.threads.messages(id),
      this.decisions.listInThread(id),
      this.proposals.listInThread(id),
    ]);
    const records = {
      decisions: new Map(decisions.map((decision) => [decision.id, decision])),
      proposals: new Map(proposals.map((proposal) => [proposal.id, proposal])),
      letGo: await this.linkCards.letGoIn(messages),
    };
    return messages.map((message) => toMessageResponse(message, records));
  }

  /**
   * The user's message, mentioning a record by linking to its page, and saying whose Handover note
   * it started from when a Link card gave it; the person's answer comes into the log as it is
   * written.
   */
  @Post("threads/:id/messages")
  @HttpCode(HttpStatus.ACCEPTED)
  async send(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(newMessageSchema)) { text, handoverNoteFrom }: NewMessage,
  ): Promise<ThreadResponse> {
    const mentions = recordLinksIn(text).map(toMention);
    return this.toResponse(await this.runner.send(id, text, mentions, handoverNoteFrom));
  }

  private async toResponse(thread: Thread): Promise<ThreadResponse> {
    const [reading, activity] = await Promise.all([
      this.contexts.read(thread),
      this.chatActivity.inThread(thread),
    ]);
    return toThreadResponse(thread, reading, activity);
  }
}

function toMention(link: RecordLink): Mention {
  switch (link.kind) {
    case "task":
      return { kind: "task", taskId: link.taskId };
    case "initiative":
      return { kind: "initiative", initiativeId: link.initiativeId };
    case "idea":
      return { kind: "idea", ideaId: link.ideaId };
    case "decision":
      return { kind: "decision", decisionId: link.decisionId };
  }
}
