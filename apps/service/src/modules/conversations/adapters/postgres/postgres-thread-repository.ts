import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Message } from "../../domain/message.js";
import type { Home, Thread, ThreadSession } from "../../domain/thread.js";
import type { ThreadChange } from "../../domain/thread-changes.js";
import { ThreadNotFound } from "../../domain/thread-not-found.js";
import { ThreadRepository, type ThreadUpdate } from "../../ports/thread-repository.js";
import { threadMessages, threads, type ThreadSessionRow } from "./threads.schema.js";

type ThreadRow = typeof threads.$inferSelect;
type MessageRow = typeof threadMessages.$inferSelect;

@Injectable()
export class PostgresThreadRepository extends ThreadRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(thread: Thread): Promise<void> {
    await this.database.insert(threads).values(toRow(thread));
  }

  async find(id: string): Promise<Thread | undefined> {
    const [row] = await this.database.select().from(threads).where(eq(threads.id, id));
    return row && toThread(row);
  }

  async listIn(home: Home): Promise<readonly Thread[]> {
    const { kind, id } = homeColumns(home);
    const rows = await this.database
      .select()
      .from(threads)
      .where(and(eq(threads.homeKind, kind), eq(threads.homeId, id)))
      .orderBy(desc(threads.startedAt), desc(threads.id));
    return rows.map(toThread);
  }

  async update<Event extends DomainEvent>(
    id: string,
    change: (thread: Thread) => ThreadChange<Event> | undefined,
  ): Promise<ThreadUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(threads)
        .where(eq(threads.id, id))
        .for("update");
      if (!row) throw new ThreadNotFound(id);
      const thread = toThread(row);
      const changed = change(thread);
      if (!changed) return { thread, event: undefined };
      await transaction.update(threads).set(toRow(changed.thread)).where(eq(threads.id, id));
      if (changed.logged.length > 0) {
        // One insert keeps the log in the messages' order: position follows the rows.
        await transaction.insert(threadMessages).values(changed.logged.map(toMessageRow));
      }
      return { thread: changed.thread, event: changed.event };
    });
  }

  async messages(threadId: string): Promise<readonly Message[]> {
    const rows = await this.database
      .select()
      .from(threadMessages)
      .where(eq(threadMessages.threadId, threadId))
      .orderBy(asc(threadMessages.position));
    return rows.map(toMessage);
  }
}

function homeColumns(home: Home): { readonly kind: Home["kind"]; readonly id: string } {
  return home.kind === "chat"
    ? { kind: "chat", id: home.roleKey }
    : { kind: "task", id: home.taskId };
}

function toRow(thread: Thread): ThreadRow {
  const home = homeColumns(thread.home);
  return {
    id: thread.id,
    homeKind: home.kind,
    homeId: home.id,
    roleKey: thread.roleKey,
    title: thread.title ?? null,
    state: thread.state,
    session: thread.session ? toSessionRow(thread.session) : null,
    override: thread.override ?? null,
    tokens: thread.tokens,
    startedAt: thread.startedAt,
  };
}

function toThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    home:
      row.homeKind === "chat"
        ? { kind: "chat", roleKey: row.homeId }
        : { kind: "task", taskId: row.homeId },
    roleKey: row.roleKey,
    title: row.title ?? undefined,
    state: row.state,
    session: row.session ? toSession(row.session) : undefined,
    override: row.override ?? undefined,
    tokens: row.tokens,
    startedAt: row.startedAt,
  };
}

function toSessionRow(session: ThreadSession): ThreadSessionRow {
  return {
    ...session,
    startedAt: session.startedAt.toISOString(),
    lastCallAt: session.lastCallAt?.toISOString() ?? null,
  };
}

function toSession(row: ThreadSessionRow): ThreadSession {
  return {
    ...row,
    startedAt: new Date(row.startedAt),
    lastCallAt: row.lastCallAt === null ? undefined : new Date(row.lastCallAt),
  };
}

function toMessageRow({ id, threadId, at, ...body }: Message): Omit<MessageRow, "position"> {
  return { id, threadId, at, body };
}

function toMessage(row: MessageRow): Message {
  return { ...row.body, id: row.id, threadId: row.threadId, at: row.at };
}
