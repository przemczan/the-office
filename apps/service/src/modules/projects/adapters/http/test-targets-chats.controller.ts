import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseFilters } from "@nestjs/common";
import { testTargetsSetUpTaskSchema, type ProjectTestTargetsChat } from "@the-office/contracts";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import {
  TestTargetsChats,
  type ProjectTestTargetsChat as ChatOfProject,
} from "../../application/test-targets-chats.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/** The Project page's Set up test targets, asked in a chat (spec §2.12). */
@Controller("projects/:id/test-targets/chat")
@UseFilters(ProjectRefusalsFilter)
export class TestTargetsChatsController {
  constructor(private readonly chats: TestTargetsChats) {}

  @Get()
  async read(@Param("id") id: string): Promise<ProjectTestTargetsChat> {
    return toResponse(await this.chats.read(id));
  }

  /** Ask, or Ask again: a new chat Thread with whoever onboards Projects, which the card follows. */
  @Post()
  @HttpCode(HttpStatus.OK)
  async ask(
    @Param("id") id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ProjectTestTargetsChat> {
    return toResponse(await this.chats.ask(id, userOf(signedIn)));
  }
}

function toResponse({ chat, setUpTask }: ChatOfProject): ProjectTestTargetsChat {
  return {
    chat: chat
      ? {
          threadId: chat.threadId,
          roleKey: chat.roleKey,
          state: chat.state,
          since: chat.since.toISOString(),
        }
      : null,
    // Work's Task state, as the set-up Task's own route answers it.
    setUpTask: setUpTask ? testTargetsSetUpTaskSchema.parse(setUpTask) : null,
  };
}
