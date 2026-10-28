import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Decision } from "../../domain/decision.js";
import type { Message } from "../../domain/message.js";
import type { Proposal, ProposalStatus } from "../../domain/proposal.js";
import type { ProposalChange } from "../../domain/proposal-changes.js";
import { ProposalNotFound } from "../../domain/proposal-not-found.js";
import type { Home, Thread, ThreadSession } from "../../domain/thread.js";
import type { ThreadChange } from "../../domain/thread-changes.js";
import { ThreadNotFound } from "../../domain/thread-not-found.js";
import { ThreadRepository, type ThreadUpdate } from "../../ports/thread-repository.js";
import {
  decisions,
  proposals,
  threadMessages,
  threads,
  type ThreadSessionRow,
} from "./threads.schema.js";

type ThreadRow = typeof threads.$inferSelect;
type MessageRow = typeof threadMessages.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;
type ProposalRow = typeof proposals.$inferSelect;
/** The client or a transaction on it: whichever reads the Threads' open Decisions. */
type Reader = Pick<Database, "select">;

@Injectable()
export class PostgresThreadRepository extends ThreadRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(thread: Thread): Promise<void> {
    await this.database.insert(threads).values(toRow(thread));
  }

  async find(id: string): Promise<Thread | undefined> {
    const rows = await this.database.select().from(threads).where(eq(threads.id, id));
    const [thread] = await withOpenDecisions(this.database, rows);
    return thread;
  }

  async findBySession(sessionId: string): Promise<Thread | undefined> {
    const rows = await this.database
      .select()
      .from(threads)
      .where(sql`${threads.session}->>'id' = ${sessionId}`);
    const [thread] = await withOpenDecisions(this.database, rows);
    return thread;
  }

  async answering(): Promise<readonly Thread[]> {
    const rows = await this.database.select().from(threads).where(eq(threads.state, "answering"));
    return withOpenDecisions(this.database, rows);
  }

  async listIn(home: Home): Promise<readonly Thread[]> {
    const { kind, id } = homeColumns(home);
    const rows = await this.database
      .select()
      .from(threads)
      .where(and(eq(threads.homeKind, kind), eq(threads.homeId, id)))
      .orderBy(desc(threads.startedAt), desc(threads.id));
    return withOpenDecisions(this.database, rows);
  }

  async listOnTasksWith(roleKey: string): Promise<readonly Thread[]> {
    const rows = await this.database
      .select()
      .from(threads)
      .where(and(eq(threads.homeKind, "task"), eq(threads.roleKey, roleKey)))
      .orderBy(desc(threads.startedAt), desc(threads.id));
    return withOpenDecisions(this.database, rows);
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
      const [thread] = await withOpenDecisions(transaction, [row]);
      if (!thread) throw new ThreadNotFound(id);
      const changed = change(thread);
      if (!changed) return { thread, event: undefined };
      await transaction.update(threads).set(toRow(changed.thread)).where(eq(threads.id, id));
      if (changed.decision) {
        const decisionRow = toDecisionRow(changed.decision);
        await transaction
          .insert(decisions)
          .values(decisionRow)
          .onConflictDoUpdate({
            target: decisions.id,
            set: {
              putTo: decisionRow.putTo,
              passedOn: decisionRow.passedOn,
              answer: decisionRow.answer,
              answeredAt: decisionRow.answeredAt,
            },
          });
      }
      if (changed.proposal) {
        await transaction.insert(proposals).values(toProposalRow(changed.proposal));
      }
      if (changed.logged.length > 0) {
        // One insert keeps the log in the messages' order: position follows the rows.
        await transaction.insert(threadMessages).values(changed.logged.map(toMessageRow));
      }
      if (changed.marked) {
        const { messageIds, delivery } = changed.marked;
        await transaction
          .update(threadMessages)
          .set({
            body: sql`${threadMessages.body} || jsonb_build_object('delivery', ${delivery}::text)`,
          })
          .where(
            and(
              eq(threadMessages.threadId, id),
              inArray(threadMessages.id, [...messageIds]),
              sql`${threadMessages.body} ->> 'kind' = 'user'`,
            ),
          );
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

  async decision(id: string): Promise<Decision | undefined> {
    const [row] = await this.database.select().from(decisions).where(eq(decisions.id, id));
    return row && toDecision(row);
  }

  async decisionsIn(threadId: string): Promise<readonly Decision[]> {
    const rows = await this.database
      .select()
      .from(decisions)
      .where(eq(decisions.threadId, threadId))
      .orderBy(asc(decisions.askedAt), asc(decisions.id));
    return rows.map(toDecision);
  }

  async answeredOn(taskId: string): Promise<readonly Decision[]> {
    const rows = await this.database
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.taskId, taskId),
          isNotNull(decisions.answeredAt),
          isNotNull(decisions.roleKey),
        ),
      )
      .orderBy(asc(decisions.answeredAt), asc(decisions.id));
    return rows.map(toDecision);
  }

  async spendApproval(decisionId: string): Promise<boolean> {
    const spent = await this.database
      .update(decisions)
      .set({ approvalSpentAt: new Date() })
      .where(and(eq(decisions.id, decisionId), isNull(decisions.approvalSpentAt)))
      .returning({ id: decisions.id });
    return spent.length > 0;
  }

  async openDecisions(): Promise<readonly Decision[]> {
    const rows = await this.database
      .select()
      .from(decisions)
      .where(and(isNull(decisions.answeredAt), isNull(decisions.putTo)))
      .orderBy(asc(decisions.askedAt), asc(decisions.id));
    return rows.map(toDecision);
  }

  async proposal(id: string): Promise<Proposal | undefined> {
    const [row] = await this.database.select().from(proposals).where(eq(proposals.id, id));
    return row && toProposal(row);
  }

  async proposalsIn(threadId: string): Promise<readonly Proposal[]> {
    const rows = await this.database
      .select()
      .from(proposals)
      .where(eq(proposals.threadId, threadId))
      .orderBy(asc(proposals.draftedAt), asc(proposals.id));
    return rows.map(toProposal);
  }

  async updateProposal<Event extends DomainEvent>(
    id: string,
    change: (proposal: Proposal) => Promise<ProposalChange<Event>>,
  ): Promise<ProposalChange<Event>> {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(proposals)
        .where(eq(proposals.id, id))
        .for("update");
      if (!row) throw new ProposalNotFound(id);
      const changed = await change(toProposal(row));
      const { change: proposed, status, statusAt } = toProposalRow(changed.proposal);
      await transaction
        .update(proposals)
        .set({ change: proposed, status, statusAt })
        .where(eq(proposals.id, id));
      return changed;
    });
  }
}

/** The Threads of `rows`, in their order, each with the Decision it waits on, if any. */
async function withOpenDecisions(reader: Reader, rows: readonly ThreadRow[]): Promise<Thread[]> {
  if (rows.length === 0) return [];
  const open = await reader
    .select()
    .from(decisions)
    .where(
      and(
        inArray(
          decisions.threadId,
          rows.map((row) => row.id),
        ),
        isNull(decisions.answeredAt),
      ),
    );
  const byThread = new Map(open.map((row) => [row.threadId, toDecision(row)]));
  return rows.map((row) => toThread(row, byThread.get(row.id)));
}

function homeColumns(home: Home): { readonly kind: Home["kind"]; readonly id: string } {
  switch (home.kind) {
    case "chat":
      return { kind: "chat", id: home.roleKey };
    case "task":
      return { kind: "task", id: home.taskId };
    case "initiative":
      return { kind: "initiative", id: home.initiativeId };
  }
}

function toHome(kind: Home["kind"], id: string): Home {
  switch (kind) {
    case "chat":
      return { kind: "chat", roleKey: id };
    case "task":
      return { kind: "task", taskId: id };
    case "initiative":
      return { kind: "initiative", initiativeId: id };
  }
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
    runningTurnTokens: thread.runningTurnTokens,
    startedAt: thread.startedAt,
    stageThread: thread.stageThread,
    consultation: thread.consultation ?? null,
  };
}

function toThread(row: ThreadRow, openDecision: Decision | undefined): Thread {
  return {
    id: row.id,
    home: toHome(row.homeKind, row.homeId),
    roleKey: row.roleKey,
    title: row.title ?? undefined,
    state: row.state,
    session: row.session ? toSession(row.session) : undefined,
    override: row.override ?? undefined,
    tokens: row.tokens,
    runningTurnTokens: row.runningTurnTokens,
    startedAt: row.startedAt,
    openDecision,
    stageThread: row.stageThread,
    consultation: row.consultation ?? undefined,
  };
}

function toSessionRow(session: ThreadSession): ThreadSessionRow {
  return {
    ...session,
    startedAt: session.startedAt.toISOString(),
    lastCallAt: session.lastCallAt?.toISOString() ?? null,
    startContextTokens: session.startContextTokens ?? null,
  };
}

function toSession(row: ThreadSessionRow): ThreadSession {
  return {
    ...row,
    startedAt: new Date(row.startedAt),
    lastCallAt: row.lastCallAt === null ? undefined : new Date(row.lastCallAt),
    startContextTokens: row.startContextTokens ?? undefined,
  };
}

function toMessageRow({ id, threadId, at, ...body }: Message): Omit<MessageRow, "position"> {
  return { id, threadId, at, body };
}

function toMessage(row: MessageRow): Message {
  return { ...row.body, id: row.id, threadId: row.threadId, at: row.at };
}

/** What a Decision is saved as; the approval it gave a held call is spent apart from it. */
type SavedDecision = Omit<DecisionRow, "approvalSpentAt">;

function toDecisionRow({ answer, roleKey, putTo, passedOn, ...fields }: Decision): SavedDecision {
  const decision = {
    ...fields,
    roleKey: roleKey ?? null,
    putTo: putTo ?? null,
    passedOn: passedOn.map(({ passedOnAt, ...passing }) => ({
      ...passing,
      passedOnAt: passedOnAt.toISOString(),
    })),
  };
  if (!answer) return { ...decision, answer: null, answeredAt: null };
  const { answeredAt, ...given } = answer;
  return { ...decision, answer: given, answeredAt };
}

function toDecision({
  answer,
  answeredAt,
  roleKey,
  putTo,
  passedOn,
  approvalSpentAt: _approvalSpentAt,
  ...row
}: DecisionRow): Decision {
  return {
    ...row,
    roleKey: roleKey ?? undefined,
    putTo: putTo ?? undefined,
    passedOn: passedOn.map(({ passedOnAt, ...passing }) => ({
      ...passing,
      passedOnAt: new Date(passedOnAt),
    })),
    answer: answer === null || answeredAt === null ? undefined : { ...answer, answeredAt },
  };
}

function toProposalRow({ status, ...proposal }: Proposal): ProposalRow {
  return {
    ...proposal,
    status: status.kind,
    statusAt: status.kind === "open" ? null : status.at,
  };
}

function toProposal({ status, statusAt, change, ...row }: ProposalRow): Proposal {
  return {
    ...row,
    // A hire not applied yet has no Role key, which its JSON leaves out.
    change: change.kind === "hire" ? { ...change, roleKey: change.roleKey ?? undefined } : change,
    status: toProposalStatus(status, statusAt),
  };
}

function toProposalStatus(kind: ProposalStatus["kind"], at: Date | null): ProposalStatus {
  if (kind === "open") return { kind };
  if (!at) throw new Error(`A ${kind} Proposal has no time it was ${kind}.`);
  return { kind, at };
}
