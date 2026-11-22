import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { TestTargetsChat } from "../../domain/test-targets-chat.js";
import { TestTargetsChatRepository } from "../../ports/test-targets-chat-repository.js";
import { testTargetsChats } from "./test-targets-chats.schema.js";

@Injectable()
export class PostgresTestTargetsChatRepository extends TestTargetsChatRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(chat: TestTargetsChat): Promise<void> {
    await this.database.insert(testTargetsChats).values({
      threadId: chat.threadId,
      projectId: chat.projectId,
      roleKey: chat.roleKey,
      askedBy: { userId: chat.askedBy.userId, name: chat.askedBy.name },
      askedAt: chat.askedAt,
    });
  }

  async newestOf(projectId: string): Promise<TestTargetsChat | undefined> {
    const [row] = await this.database
      .select()
      .from(testTargetsChats)
      .where(eq(testTargetsChats.projectId, projectId))
      .orderBy(desc(testTargetsChats.askedAt), desc(testTargetsChats.threadId))
      .limit(1);
    return row && { ...row };
  }
}
