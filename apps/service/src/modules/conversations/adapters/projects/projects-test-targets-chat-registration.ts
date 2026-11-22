import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Duties } from "../../../people/index.js";
import {
  TestTargetsChatThreads,
  type TestTargetsChatThread,
  type TestTargetsChatThreadStart,
} from "../../../projects/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import { ThreadService } from "../../application/thread-service.js";
import { ChatNotFound } from "../../domain/chat-not-found.js";
import { ThreadNotFound } from "../../domain/thread-not-found.js";
import { ThreadRefused } from "../../domain/thread-refused.js";

/**
 * Gives Projects the Project page's Set up test targets chat (spec §2.12): a new chat Thread with
 * whoever holds "Onboards and repairs Projects", titled, with no message sent, on the base
 * checkouts as every chat reads them; and what that Thread holds now, for the page's card.
 * Conversations reads Projects, so Projects can't ask it directly.
 */
@Injectable()
export class ProjectsTestTargetsChatRegistration implements OnModuleInit {
  constructor(
    private readonly registry: TestTargetsChatThreads,
    private readonly duties: Duties,
    private readonly threads: ThreadService,
    private readonly proposals: ProposalService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      start: (title) => this.start(title),
      read: (threadId, projectId) => this.read(threadId, projectId),
    });
  }

  private async start(title: string): Promise<TestTargetsChatThreadStart> {
    const holder = await this.duties.holderOf("onboards-projects");
    if (holder === undefined) return { kind: "nobody" };
    try {
      const thread = await this.threads.startInChat(holder, title);
      return { kind: "started", threadId: thread.id, roleKey: thread.roleKey };
    } catch (error) {
      if (error instanceof ThreadRefused) return { kind: "refused", reasons: error.reasons };
      if (error instanceof ChatNotFound) return { kind: "nobody" };
      throw error;
    }
  }

  private async read(
    threadId: string,
    projectId: string,
  ): Promise<TestTargetsChatThread | undefined> {
    try {
      const thread = await this.threads.read(threadId);
      const [messages, proposals] = await Promise.all([
        this.threads.messages(threadId),
        this.proposals.listInThread(threadId),
      ]);
      const last = messages.at(-1);
      const lastUser = messages.findLast((message) => message.kind === "user");
      return {
        answering: thread.state === "answering",
        lastUserMessageAt: lastUser?.at,
        lastMessageAt: last?.at,
        proposals: proposals
          .filter(({ change }) => change.kind === "test-targets" && change.projectId === projectId)
          .map(({ status, draftedAt }) => ({ open: status.kind === "open", draftedAt })),
      };
    } catch (error) {
      if (error instanceof ThreadNotFound) return undefined;
      throw error;
    }
  }
}
