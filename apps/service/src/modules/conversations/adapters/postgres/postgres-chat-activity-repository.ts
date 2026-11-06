import { Inject, Injectable } from "@nestjs/common";
import { and, eq, notInArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { ChatThreadActivity } from "../../domain/chat-activity.js";
import { USERS_OWN_MESSAGE_KINDS } from "../../domain/message.js";
import { ChatActivityRepository, type SeenMark } from "../../ports/chat-activity-repository.js";
import { threadSeen } from "./thread-seen.schema.js";
import { threadMessages, threads } from "./threads.schema.js";

const seenMessage = alias(threadMessages, "seen_message");
const logged = alias(threadMessages, "logged");

@Injectable()
export class PostgresChatActivityRepository extends ChatActivityRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async markSeen(threadId: string, messageId: string, seenAt: Date): Promise<SeenMark> {
    const [message] = await this.database
      .select({ position: threadMessages.position })
      .from(threadMessages)
      .where(and(eq(threadMessages.id, messageId), eq(threadMessages.threadId, threadId)));
    if (!message) return "no-such-message";
    const moved = await this.database
      .insert(threadSeen)
      .values({ threadId, messageId, seenAt })
      .onConflictDoUpdate({
        target: threadSeen.threadId,
        set: { messageId, seenAt },
        setWhere: sql`(select ${threadMessages.position} from ${threadMessages} where ${threadMessages.id} = ${threadSeen.messageId}) < ${message.position}`,
      })
      .returning({ threadId: threadSeen.threadId });
    return moved.length > 0 ? "moved" : "stayed";
  }

  chatThreads(): Promise<readonly ChatThreadActivity[]> {
    return this.read(eq(threads.homeKind, "chat"));
  }

  async chatThread(threadId: string): Promise<ChatThreadActivity | undefined> {
    const [thread] = await this.read(and(eq(threads.homeKind, "chat"), eq(threads.id, threadId)));
    return thread;
  }

  /** Each scalar reads back from the log's end by its index, so a long log costs nothing here. */
  private async read(which: SQL | undefined): Promise<readonly ChatThreadActivity[]> {
    const rows = await this.database
      .select({
        threadId: threads.id,
        roleKey: threads.roleKey,
        state: threads.state,
        lastMovedAt: sql`coalesce((${newestLogged(undefined)}), ${threads.startedAt})`.mapWith(
          threads.startedAt,
        ),
        unseenAnswerAt: sql`(${newestLogged(
          and(
            sql`${logged.position} > coalesce(${seenMessage.position}, 0)`,
            notInArray(sql`${logged.body}->>'kind'`, [...USERS_OWN_MESSAGE_KINDS]),
          ),
        )})`.mapWith(threads.startedAt),
      })
      .from(threads)
      .leftJoin(threadSeen, eq(threadSeen.threadId, threads.id))
      .leftJoin(seenMessage, eq(seenMessage.id, threadSeen.messageId))
      .where(which);
    return rows.map(({ unseenAnswerAt, ...row }) => ({
      ...row,
      unseenAnswerAt: unseenAnswerAt ?? undefined,
    }));
  }
}

function newestLogged(among: SQL | undefined): SQL {
  const inThread = eq(logged.threadId, threads.id);
  return sql`select ${logged.at} from ${threadMessages} as ${sql.identifier("logged")} where ${and(inThread, among)} order by ${logged.position} desc limit 1`;
}
