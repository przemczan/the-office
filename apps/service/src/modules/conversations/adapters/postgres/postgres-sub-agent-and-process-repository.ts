import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  byteLength,
  ENDED_ITEMS_KEPT,
  MESSAGES_KEPT,
  OUTPUT_KEPT_BYTES,
  outputTrim,
  type OutputChunk,
  type SubAgentMessage,
  type SubAgentMessageDraft,
  type SubAgentOrProcess,
} from "../../domain/sub-agents-and-processes.js";
import {
  SubAgentAndProcessRepository,
  type ItemKey,
} from "../../ports/sub-agent-and-process-repository.js";
import {
  processOutput,
  subAgentMessages,
  subAgentsAndProcesses,
} from "./sub-agents-and-processes.schema.js";

type ItemRow = typeof subAgentsAndProcesses.$inferSelect;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

@Injectable()
export class PostgresSubAgentAndProcessRepository extends SubAgentAndProcessRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(item: SubAgentOrProcess): Promise<boolean> {
    const added = await this.database
      .insert(subAgentsAndProcesses)
      .values(toRow(item))
      .onConflictDoNothing()
      .returning({ callId: subAgentsAndProcesses.callId });
    return added.length > 0;
  }

  async find(key: ItemKey): Promise<SubAgentOrProcess | undefined> {
    const [row] = await this.database.select().from(subAgentsAndProcesses).where(byKey(key));
    return row && fromRow(row);
  }

  async save(item: SubAgentOrProcess): Promise<void> {
    const { lastSequence: _sequence, ...fields } = toRow(item);
    await this.database.transaction(async (transaction) => {
      await transaction.update(subAgentsAndProcesses).set(fields).where(byKey(item));
      if (item.ending !== undefined) await dropEndedPastCap(transaction, item.sessionId);
    });
  }

  async addMessages(
    key: ItemKey,
    drafts: readonly SubAgentMessageDraft[],
    at: Date,
  ): Promise<readonly SubAgentMessage[]> {
    if (drafts.length === 0) return [];
    return this.database.transaction(async (transaction) => {
      const first = await takeSequences(transaction, key, drafts.length);
      if (first === undefined) return [];
      const messages = drafts.map((draft, index): SubAgentMessage => ({
        ...draft,
        sequence: first + index,
        at,
      }));
      await transaction.insert(subAgentMessages).values(
        messages.map(({ sequence, at: messageAt, ...body }) => ({
          ...key,
          sequence,
          at: messageAt,
          body: body as SubAgentMessageDraft,
        })),
      );
      const keptFrom = first + drafts.length - MESSAGES_KEPT;
      const dropped = await transaction
        .delete(subAgentMessages)
        .where(and(byMessageKey(key), lte(subAgentMessages.sequence, keptFrom - 1)))
        .returning({ sequence: subAgentMessages.sequence });
      if (dropped.length > 0) {
        await transaction
          .update(subAgentsAndProcesses)
          .set({
            earlierMessagesNotKept: sql`${subAgentsAndProcesses.earlierMessagesNotKept} + ${dropped.length}`,
          })
          .where(byKey(key));
      }
      return messages;
    });
  }

  async addOutput(key: ItemKey, text: string): Promise<OutputChunk | undefined> {
    return this.database.transaction(async (transaction) => {
      const sequence = await takeSequences(transaction, key, 1);
      if (sequence === undefined) return undefined;
      await transaction.insert(processOutput).values({ ...key, sequence, text });
      const [counted] = await transaction
        .update(subAgentsAndProcesses)
        .set({ keptBytes: sql`${subAgentsAndProcesses.keptBytes} + ${byteLength(text)}` })
        .where(byKey(key))
        .returning({ keptBytes: subAgentsAndProcesses.keptBytes });
      if (counted && counted.keptBytes > OUTPUT_KEPT_BYTES) await trimOutput(transaction, key);
      return { sequence, text };
    });
  }

  async ofSession(sessionId: string): Promise<readonly SubAgentOrProcess[]> {
    const rows = await this.database
      .select()
      .from(subAgentsAndProcesses)
      .where(eq(subAgentsAndProcesses.sessionId, sessionId))
      .orderBy(asc(subAgentsAndProcesses.startedAt), asc(subAgentsAndProcesses.callId));
    return rows.map(fromRow);
  }

  async messagesAfter(key: ItemKey, sequence: number): Promise<readonly SubAgentMessage[]> {
    const rows = await this.database
      .select()
      .from(subAgentMessages)
      .where(and(byMessageKey(key), gt(subAgentMessages.sequence, sequence)))
      .orderBy(asc(subAgentMessages.sequence));
    return rows.map(({ sequence: messageSequence, at, body }) => ({
      ...body,
      sequence: messageSequence,
      at,
    }));
  }

  async outputAfter(key: ItemKey, sequence: number): Promise<readonly OutputChunk[]> {
    return this.database
      .select({ sequence: processOutput.sequence, text: processOutput.text })
      .from(processOutput)
      .where(and(byOutputKey(key), gt(processOutput.sequence, sequence)))
      .orderBy(asc(processOutput.sequence));
  }

  async running(): Promise<readonly SubAgentOrProcess[]> {
    const rows = await this.database
      .select()
      .from(subAgentsAndProcesses)
      .where(isNull(subAgentsAndProcesses.ending));
    return rows.map(fromRow);
  }

  async removeSession(sessionId: string): Promise<void> {
    await this.database
      .delete(subAgentsAndProcesses)
      .where(eq(subAgentsAndProcesses.sessionId, sessionId));
  }
}

/** Moves the item's sequence on by `count`: the first taken, or undefined with no such item. */
async function takeSequences(
  transaction: Transaction,
  key: ItemKey,
  count: number,
): Promise<number | undefined> {
  const [taken] = await transaction
    .update(subAgentsAndProcesses)
    .set({ lastSequence: sql`${subAgentsAndProcesses.lastSequence} + ${count}` })
    .where(byKey(key))
    .returning({ lastSequence: subAgentsAndProcesses.lastSequence });
  return taken && taken.lastSequence - count + 1;
}

/** Drops the earliest output past the cap, oldest first, the first chunk kept cut at its head. */
async function trimOutput(transaction: Transaction, key: ItemKey): Promise<void> {
  const kept = await transaction
    .select({ sequence: processOutput.sequence, text: processOutput.text })
    .from(processOutput)
    .where(byOutputKey(key))
    .orderBy(asc(processOutput.sequence));
  const trim = outputTrim(kept);
  if (trim.droppedSequences.length > 0) {
    await transaction
      .delete(processOutput)
      .where(and(byOutputKey(key), inArray(processOutput.sequence, [...trim.droppedSequences])));
  }
  if (trim.shortened) {
    await transaction
      .update(processOutput)
      .set({ text: trim.shortened.text })
      .where(and(byOutputKey(key), eq(processOutput.sequence, trim.shortened.sequence)));
  }
  await transaction
    .update(subAgentsAndProcesses)
    .set({
      keptBytes: sql`${subAgentsAndProcesses.keptBytes} - ${trim.droppedBytes}`,
      earlierOutputNotKept: sql`${subAgentsAndProcesses.earlierOutputNotKept} + ${trim.droppedBytes}`,
    })
    .where(byKey(key));
}

/** The session's ended items past the latest `ENDED_ITEMS_KEPT` go, with what they kept. */
async function dropEndedPastCap(transaction: Transaction, sessionId: string): Promise<void> {
  const pastCap = await transaction
    .select({ callId: subAgentsAndProcesses.callId })
    .from(subAgentsAndProcesses)
    .where(
      and(eq(subAgentsAndProcesses.sessionId, sessionId), isNotNull(subAgentsAndProcesses.ending)),
    )
    .orderBy(desc(subAgentsAndProcesses.endedAt), desc(subAgentsAndProcesses.callId))
    .offset(ENDED_ITEMS_KEPT);
  if (pastCap.length === 0) return;
  await transaction.delete(subAgentsAndProcesses).where(
    and(
      eq(subAgentsAndProcesses.sessionId, sessionId),
      inArray(
        subAgentsAndProcesses.callId,
        pastCap.map(({ callId }) => callId),
      ),
    ),
  );
}

function byKey({ sessionId, callId }: ItemKey) {
  return and(
    eq(subAgentsAndProcesses.sessionId, sessionId),
    eq(subAgentsAndProcesses.callId, callId),
  );
}

function byMessageKey({ sessionId, callId }: ItemKey) {
  return and(eq(subAgentMessages.sessionId, sessionId), eq(subAgentMessages.callId, callId));
}

function byOutputKey({ sessionId, callId }: ItemKey) {
  return and(eq(processOutput.sessionId, sessionId), eq(processOutput.callId, callId));
}

function toRow(item: SubAgentOrProcess): typeof subAgentsAndProcesses.$inferInsert {
  const shared = {
    sessionId: item.sessionId,
    callId: item.callId,
    threadId: item.threadId,
    kind: item.kind,
    engineTaskId: item.engineTaskId ?? null,
    startedBy: item.startedBy ?? null,
    description: item.description,
    ending: item.ending ?? null,
    startedAt: item.startedAt,
    endedAt: item.endedAt ?? null,
    revision: item.revision,
    lastSequence: item.lastSequence,
  };
  return item.kind === "sub-agent"
    ? {
        ...shared,
        agentKind: item.agentKind ?? null,
        prompt: item.prompt,
        background: item.background,
        reportedBack: item.reportedBack ?? null,
        toolCallCount: item.toolCallCount ?? null,
        totalTokens: item.totalTokens ?? null,
      }
    : { ...shared, commandLine: item.commandLine, exitCode: item.exitCode ?? null };
}

function fromRow(row: ItemRow): SubAgentOrProcess {
  const shared = {
    threadId: row.threadId,
    sessionId: row.sessionId,
    callId: row.callId,
    engineTaskId: row.engineTaskId ?? undefined,
    startedBy: row.startedBy ?? undefined,
    description: row.description,
    ending: row.ending ?? undefined,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    revision: row.revision,
    lastSequence: row.lastSequence,
  };
  return row.kind === "sub-agent"
    ? {
        ...shared,
        kind: "sub-agent",
        agentKind: row.agentKind ?? undefined,
        prompt: row.prompt ?? "",
        background: row.background ?? false,
        reportedBack: row.reportedBack ?? undefined,
        toolCallCount: row.toolCallCount ?? undefined,
        totalTokens: row.totalTokens ?? undefined,
        earlierMessagesNotKept: row.earlierMessagesNotKept,
      }
    : {
        ...shared,
        kind: "process",
        commandLine: row.commandLine ?? "",
        exitCode: row.exitCode ?? undefined,
        earlierOutputNotKept: row.earlierOutputNotKept,
      };
}
