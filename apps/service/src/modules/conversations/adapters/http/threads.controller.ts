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
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  chatThreadsDeletionSchema,
  contextOverrideChoiceSchema,
  messageCommand,
  messageImageUploadQuerySchema,
  newMessageSchema,
  pageQuerySchema,
  recordLinksIn,
  threadMessagesQuerySchema,
  threadSeenSchema,
  threadTitleSchema,
  type ChatActivity as ChatActivityResponse,
  type ChatThreadsDeletion,
  type ChatThreadPage,
  type PageQuery,
  type TaskThreadPage,
  type RecordLink,
  type ContextOverrideChoice,
  type Message as MessageResponse,
  type MessageImage as MessageImageResponse,
  type MessageImageUploadQuery,
  type NewMessage,
  type PeopleWorking as PeopleWorkingResponse,
  type Thread as ThreadResponse,
  type ThreadMessagesQuery,
  type ThreadSeen,
  type ThreadStop,
  type ThreadTitle,
  type FirstBrief,
  type TaskConversation as TaskConversationResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { pageRequested, toPageResponse } from "../../../../platform/http/page-cursors.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { uploadedBytes } from "../../../../platform/http/upload-body.js";
import { AllowChanges } from "../../application/allow-changes.js";
import { ChatActivity } from "../../application/chat-activity.js";
import { ChatThreadDeletions } from "../../application/chat-thread-deletions.js";
import { DecisionService } from "../../application/decision-service.js";
import { LinkCards } from "../../application/link-cards.js";
import { ProposalService } from "../../application/proposal-service.js";
import { TaskConversations } from "../../application/task-conversations.js";
import { ThreadContexts } from "../../application/thread-contexts.js";
import { ThreadRunner, type SkillCommandSent } from "../../application/thread-runner.js";
import { ThreadImages } from "../../application/thread-images.js";
import { ThreadService } from "../../application/thread-service.js";
import { ThreadSummaries } from "../../application/thread-summaries.js";
import type { Mention } from "../../domain/mention.js";
import type { Thread } from "../../domain/thread.js";
import {
  toChatActivityResponse,
  toMessageResponse,
  toPeopleWorkingResponse,
  toTaskConversationResponse,
  toTaskThreadSummaryResponse,
  toThreadResponse,
  toThreadSummaryResponse,
} from "./conversation-responses.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

/** The route the upload body is read on; ConversationsModule applies `uploadBody` to it. */
export const THREAD_IMAGE_UPLOAD_ROUTE = "threads/:id/images";

@Controller()
@UseFilters(ThreadRefusalsFilter)
export class ThreadsController {
  constructor(
    private readonly threads: ThreadService,
    private readonly contexts: ThreadContexts,
    private readonly summaries: ThreadSummaries,
    private readonly runner: ThreadRunner,
    private readonly decisions: DecisionService,
    private readonly proposals: ProposalService,
    private readonly linkCards: LinkCards,
    private readonly allowChanges: AllowChanges,
    private readonly chatActivity: ChatActivity,
    private readonly taskConversations: TaskConversations,
    private readonly images: ThreadImages,
    private readonly deletions: ChatThreadDeletions,
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

  /**
   * A page of the person's chat, the newest started first. Its Threads stay readable after Chat is
   * switched off (spec §2.2).
   */
  @Get("chats/:roleKey/threads")
  async listInChat(
    @Param("roleKey") roleKey: string,
    @Query(new ContractPipe(pageQuerySchema)) { after }: PageQuery,
  ): Promise<ChatThreadPage> {
    const page = await this.summaries.inChat(roleKey, pageRequested(after));
    return toPageResponse(page, toThreadSummaryResponse);
  }

  /** A fresh Thread in the person's chat. */
  @Post("chats/:roleKey/threads")
  async startInChat(@Param("roleKey") roleKey: string): Promise<ThreadResponse> {
    return this.toResponse(await this.threads.startInChat(roleKey));
  }

  /**
   * Deletes the person's chat Threads, all or nothing (spec §2.4.1): refused, with its reasons, when
   * one isn't in their chat or can't be deleted yet.
   */
  @Post("chats/:roleKey/threads/delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteInChat(
    @Param("roleKey") roleKey: string,
    @Body(new ContractPipe(chatThreadsDeletionSchema)) { threadIds }: ChatThreadsDeletion,
  ): Promise<void> {
    await this.deletions.delete(roleKey, threadIds);
  }

  @Get("tasks/:taskId/threads")
  async listOnTask(@Param("taskId", ParseUUIDPipe) taskId: string): Promise<ThreadResponse[]> {
    return this.toResponses(await this.threads.listOnTask(taskId));
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
    return this.toResponses(await this.threads.listOnInitiative(initiativeId));
  }

  /** A page of the person's Threads on every Task, the newest started first, each with its Task. */
  @Get("roles/:roleKey/task-threads")
  async listOnTasksWith(
    @Param("roleKey") roleKey: string,
    @Query(new ContractPipe(pageQuerySchema)) { after }: PageQuery,
  ): Promise<TaskThreadPage> {
    const page = await this.summaries.onTasksWith(roleKey, pageRequested(after));
    return toPageResponse(page, toTaskThreadSummaryResponse);
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
  async allow(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ThreadResponse> {
    return this.toResponse(await this.allowChanges.allow(id, userOf(signedIn)));
  }

  /** Switches changes off in the Thread: its session ends, and the Caretaker only reads again. */
  @Delete("threads/:id/allow-changes")
  async switchOff(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ThreadResponse> {
    return this.toResponse(await this.allowChanges.switchOff(id, userOf(signedIn)));
  }

  /**
   * Stops the person answering in the Thread now, keeping their session (spec §2.4.5): nothing
   * changes between turns, and a Stage Thread or a Consultation refuses.
   */
  @Post("threads/:id/stop")
  @HttpCode(HttpStatus.OK)
  async stop(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ThreadStop> {
    return this.runner.stop(id, userOf(signedIn));
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
   * Proposal's card the Proposal, and each Link card whether its person was let go; with
   * `?after=`, only what was logged after that message, as a page holding the log up to it reads on.
   */
  @Get("threads/:id/messages")
  async messages(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ContractPipe(threadMessagesQuerySchema)) { after }: ThreadMessagesQuery,
  ): Promise<MessageResponse[]> {
    // A card's message and its Decision or Proposal commit together, so they're read after the
    // messages: read alongside, a card committed in between came without its record.
    const messages = await this.threads.messages(id, after);
    const [decisions, proposals] = await Promise.all([
      this.decisions.listInThread(id),
      this.proposals.listInThread(id),
    ]);
    const records = {
      decisions: new Map(decisions.map((decision) => [decision.id, decision])),
      proposals: new Map(
        proposals.map((proposal) => [proposal.id, this.proposals.shown(proposal)]),
      ),
      letGo: await this.linkCards.letGoIn(messages),
    };
    return messages.map((message) => toMessageResponse(message, records));
  }

  /**
   * The signed-in user's message, mentioning a record by linking to its page, with the page open
   * beside the chat drawer, and saying whose Handover note it started from when a Link card gave
   * it; the person's answer comes into the log as it is written.
   */
  @Post("threads/:id/messages")
  @HttpCode(HttpStatus.ACCEPTED)
  async send(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(newMessageSchema))
    { text, handoverNoteFrom, openPage, images }: NewMessage,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ThreadResponse> {
    const mentions = recordLinksIn(text).map(toMention);
    return this.toResponse(
      await this.runner.send(id, text, userOf(signedIn), {
        mentions,
        handoverNoteFrom,
        openPage,
        skillCommandAmong: (names) => skillCommandIn(text, names),
        images,
      }),
    );
  }

  /**
   * An image the user pasted or dropped into the Thread's message box, kept for the message they
   * send it with: the body is the image itself, as `application/octet-stream`.
   */
  @Post(THREAD_IMAGE_UPLOAD_ROUTE)
  async keepImage(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ContractPipe(messageImageUploadQuerySchema))
    { fileName }: MessageImageUploadQuery,
    @Body() body: unknown,
    @SignedIn() signedIn: SignedIn,
  ): Promise<MessageImageResponse> {
    // Kept as the type its bytes are, not the `mediaType` the browser named.
    const image = { name: fileName, content: uploadedBytes(body) };
    return this.images.keep(id, image, userOf(signedIn));
  }

  private async toResponse(thread: Thread): Promise<ThreadResponse> {
    const [reading, activity] = await Promise.all([
      this.contexts.read(thread),
      this.chatActivity.inThread(thread),
    ]);
    return toThreadResponse(thread, reading, activity);
  }

  /** A list's Threads, reading what they share once (`ThreadContexts.readEach`). */
  private async toResponses(threads: readonly Thread[]): Promise<ThreadResponse[]> {
    const [readings, activity] = await Promise.all([
      this.contexts.readEach(threads),
      this.chatActivity.inThreads(threads),
    ]);
    return threads.map((thread, index) =>
      toThreadResponse(thread, readings[index]!, activity.get(thread.id)),
    );
  }
}

/** The skill command the message is among `names`, as the web reads it too (spec §2.4). */
function skillCommandIn(text: string, names: readonly string[]): SkillCommandSent | undefined {
  const command = messageCommand(text, names);
  return command?.kind === "skill" ? { name: command.name, input: command.input } : undefined;
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
