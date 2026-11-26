import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { afterCursor, newestFirst } from "../../../../platform/database/page-sql.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import {
  authorityWithHardSwitches,
  hardSwitchesOf,
  hiredKeyOf,
  type Authority,
  type HardSwitches,
  type RoleCard,
} from "../../../people/index.js";
import {
  DEFAULT_PORT_VARIABLE,
  type ActionFields,
  type ProjectCommandFields,
  type ProposedTestTargetFields,
} from "../../../projects/index.js";
import {
  formAnswerFromOne,
  formFromOne,
  oneAnswerView,
  oneQuestionKind,
  oneQuestionView,
  type Decision,
  type GivenAnswer,
} from "../../domain/decision.js";
import type { Message, MessageDraft } from "../../domain/message.js";
import { NO_OFFICE_INSTRUCTIONS } from "../../domain/office-instructions.js";
import type {
  Proposal,
  ProposalDeclinedBecause,
  ProposalStatus,
  RoleCardFields,
} from "../../domain/proposal.js";
import type { ProposalChange } from "../../domain/proposal-changes.js";
import { ProposalNotFound } from "../../domain/proposal-not-found.js";
import type { Home, Thread, ThreadSession } from "../../domain/thread.js";
import type { ThreadChange } from "../../domain/thread-changes.js";
import { ThreadNotFound } from "../../domain/thread-not-found.js";
import type { UserRef } from "../../domain/user.js";
import {
  ThreadRepository,
  type LoggedMessage,
  type LoggedMessagesRange,
  type NewestFirstAfter,
  type NewestInitiativeThread,
  type ProposalInHome,
  type PersonsThreads,
  type PersonsThreadsRead,
  type TaskThreadTitle,
  type ThreadUpdate,
} from "../../ports/thread-repository.js";
import {
  decisions,
  proposals,
  threadMessages,
  threads,
  type SavedMessage,
  type ThreadSessionRow,
} from "./threads.schema.js";
import {
  fromSavedFormAnswer,
  fromSavedQuestions,
  toSavedFormAnswer,
  toSavedQuestions,
} from "./saved-decision-forms.js";

type ThreadRow = typeof threads.$inferSelect;
type MessageRow = typeof threadMessages.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;
type ProposalRow = typeof proposals.$inferSelect;
/** The client or a transaction on it: whichever reads the Threads' open Decisions. */
type Reader = Pick<Database, "select">;

/** A Thread's logged message, read back from the log's end in a scalar subquery. */
const logged = alias(threadMessages, "logged");

/** A Decision still open: neither answered nor closed. */
const unanswered = and(isNull(decisions.answeredAt), isNull(decisions.closedAt));

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

  async busy(): Promise<readonly Thread[]> {
    const holdingOpenDecisions = this.database
      .select({ threadId: decisions.threadId })
      .from(decisions)
      .where(unanswered);
    const rows = await this.database
      .select()
      .from(threads)
      .where(or(eq(threads.state, "answering"), inArray(threads.id, holdingOpenDecisions)));
    return withOpenDecisions(this.database, rows);
  }

  async lastCallsByPerson(): Promise<ReadonlyMap<string, Date>> {
    // Read as `started_at` is, so the driver's timestamp text becomes a Date the same way.
    const lastCallAt =
      sql<Date | null>`max((${threads.session}->>'lastCallAt')::timestamptz)`.mapWith(
        threads.startedAt,
      );
    const rows = await this.database
      .select({ roleKey: threads.roleKey, lastCallAt })
      .from(threads)
      .groupBy(threads.roleKey);
    return new Map(rows.flatMap(({ roleKey, lastCallAt: at }) => (at ? [[roleKey, at]] : [])));
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

  async personsThreads(
    roleKey: string,
    where: PersonsThreads,
    after: NewestFirstAfter | undefined,
    limit: number,
  ): Promise<PersonsThreadsRead> {
    // A chat's Threads are its person's own, so both lists are the person's Threads of one kind.
    const persons = and(eq(threads.homeKind, where), eq(threads.roleKey, roleKey));
    const [rows, [counted]] = await Promise.all([
      this.database
        .select()
        .from(threads)
        .where(and(persons, afterCursor(after, threads.startedAt, threads.id)))
        .orderBy(...newestFirst(threads.startedAt, threads.id))
        .limit(limit),
      this.database.select({ total: count() }).from(threads).where(persons),
    ]);
    return { threads: await withOpenDecisions(this.database, rows), total: counted?.total ?? 0 };
  }

  async titlesOnTasksWith(roleKey: string): Promise<readonly TaskThreadTitle[]> {
    const rows = await this.database
      .select({ taskId: threads.homeId, title: threads.title })
      .from(threads)
      .where(and(eq(threads.homeKind, "task"), eq(threads.roleKey, roleKey)))
      .orderBy(...newestFirst(threads.startedAt, threads.id));
    return rows.map(({ taskId, title }) => ({ taskId, title: title ?? undefined }));
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
              formAnswer: decisionRow.formAnswer,
              answeredAt: decisionRow.answeredAt,
              closedAt: decisionRow.closedAt,
            },
          });
      }
      if (changed.proposal) {
        await transaction.insert(proposals).values(toProposalRow(changed.proposal));
      }
      if (changed.logged.length > 0) {
        // One insert keeps the log in the messages' order: position follows the rows.
        const asked = [...thread.openDecisions, ...(changed.decision ? [changed.decision] : [])];
        await transaction
          .insert(threadMessages)
          .values(changed.logged.map((message) => toMessageRow(message, asked)));
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
              sql`${threadMessages.body} ->> 'kind' in ('user', 'decision-answer')`,
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

  async loggedIn(range: LoggedMessagesRange): Promise<readonly LoggedMessage[]> {
    if (range.homes?.length === 0) return [];
    const rows = await this.database
      .select({ message: threadMessages, thread: threads })
      .from(threadMessages)
      .innerJoin(threads, eq(threads.id, threadMessages.threadId))
      .where(loggedInRange(range))
      .orderBy(asc(threadMessages.position));
    const threadRows = [...new Map(rows.map(({ thread }) => [thread.id, thread])).values()];
    const byId = new Map(
      (await withOpenDecisions(this.database, threadRows)).map((thread) => [thread.id, thread]),
    );
    return rows.flatMap(({ message, thread }) => {
      const found = byId.get(thread.id);
      return found ? [{ thread: found, message: toMessage(message) }] : [];
    });
  }

  async countLoggedIn(range: LoggedMessagesRange): Promise<number> {
    if (range.homes?.length === 0) return 0;
    const [row] = await this.database
      .select({ logged: count() })
      .from(threadMessages)
      .innerJoin(threads, eq(threads.id, threadMessages.threadId))
      .where(loggedInRange(range));
    return row?.logged ?? 0;
  }

  async decision(id: string): Promise<Decision | undefined> {
    const [row] = await this.database
      .select(DECISION_READ)
      .from(decisions)
      .innerJoin(threads, eq(threads.id, decisions.threadId))
      .where(eq(decisions.id, id));
    return row && toDecision(row);
  }

  async holdingDecision<Result>(
    id: string,
    work: (decision: Decision | undefined) => Promise<Result>,
  ): Promise<Result> {
    // A lock on the Decision's id, not its row, so `work` can still update the row through
    // `update`'s own transaction; the Decision is read after the lock, as the last holder left it.
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`conversations.decision.${id}`}))`,
      );
      return work(await this.decision(id));
    });
  }

  async decisionsWithIds(ids: readonly string[]): Promise<readonly Decision[]> {
    if (ids.length === 0) return [];
    const rows = await this.database
      .select(DECISION_READ)
      .from(decisions)
      .innerJoin(threads, eq(threads.id, decisions.threadId))
      .where(inArray(decisions.id, [...ids]));
    return rows.map(toDecision);
  }

  async decisionsIn(threadId: string): Promise<readonly Decision[]> {
    const rows = await this.database
      .select(DECISION_READ)
      .from(decisions)
      .innerJoin(threads, eq(threads.id, decisions.threadId))
      .where(eq(decisions.threadId, threadId))
      .orderBy(asc(decisions.askedAt), asc(decisions.id));
    return rows.map(toDecision);
  }

  async answeredOn(taskId: string): Promise<readonly Decision[]> {
    const rows = await this.database
      .select(DECISION_READ)
      .from(decisions)
      .innerJoin(threads, eq(threads.id, decisions.threadId))
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
      .select(DECISION_READ)
      .from(decisions)
      .innerJoin(threads, eq(threads.id, decisions.threadId))
      .where(
        and(
          unanswered,
          isNull(decisions.putTo),
          isNotNull(decisions.taskId),
          // A chat's Decision waits on the user inline in the chat, never under Needs you (spec §2.7).
          ne(threads.homeKind, "chat"),
        ),
      )
      .orderBy(asc(decisions.askedAt), asc(decisions.id));
    return rows.map(toDecision);
  }

  async openInInitiativeThreads(): Promise<
    readonly (Decision & { readonly initiativeId: string })[]
  > {
    const rows = await this.database
      .select({ ...DECISION_READ, initiativeId: threads.homeId })
      .from(decisions)
      .innerJoin(threads, eq(threads.id, decisions.threadId))
      .where(
        and(
          eq(threads.homeKind, "initiative"),
          isNull(decisions.taskId),
          isNull(decisions.putTo),
          unanswered,
        ),
      )
      .orderBy(asc(decisions.askedAt), asc(decisions.id));
    return rows.map(({ initiativeId, ...read }) => ({ ...toDecision(read), initiativeId }));
  }

  async unansweredOn(taskId: string): Promise<readonly Decision[]> {
    return this.unansweredWhere(eq(decisions.taskId, taskId));
  }

  async unansweredOnNoTask(): Promise<readonly Decision[]> {
    return this.unansweredWhere(isNull(decisions.taskId));
  }

  private async unansweredWhere(where: SQL): Promise<readonly Decision[]> {
    const rows = await this.database
      .select(DECISION_READ)
      .from(decisions)
      .innerJoin(threads, eq(threads.id, decisions.threadId))
      .where(and(where, unanswered))
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

  async openProposals(): Promise<readonly Proposal[]> {
    const rows = await this.database
      .select()
      .from(proposals)
      .where(eq(proposals.status, "open"))
      .orderBy(desc(proposals.draftedAt), desc(proposals.id));
    return rows.map(toProposal);
  }

  async openProposalsInHomes(): Promise<readonly ProposalInHome[]> {
    const rows = await this.database
      .select({
        proposal: proposals,
        homeKind: threads.homeKind,
        homeId: threads.homeId,
        roleKey: threads.roleKey,
        consultation: threads.consultation,
      })
      .from(proposals)
      .innerJoin(threads, eq(threads.id, proposals.threadId))
      .where(eq(proposals.status, "open"))
      .orderBy(asc(proposals.draftedAt), asc(proposals.id));
    return rows.map(({ proposal, homeKind, homeId, roleKey, consultation }) => ({
      proposal: toProposal(proposal),
      thread: { home: toHome(homeKind, homeId), roleKey, consultation: consultation ?? undefined },
    }));
  }

  async newestInitiativeThreads(
    initiativeIds: readonly string[],
  ): Promise<readonly NewestInitiativeThread[]> {
    if (initiativeIds.length === 0) return [];
    // Each scalar reads back from the log's end by its index, so a long log costs nothing here.
    const newestOfKind = (kind: Message["kind"], column: AnyPgColumn) =>
      sql`(select ${column} from ${threadMessages} as ${sql.identifier("logged")} where ${logged.threadId} = ${threads.id} and ${logged.body}->>'kind' = ${kind} order by ${logged.position} desc limit 1)`;
    const rows = await this.database
      .selectDistinctOn([threads.homeId], {
        initiativeId: threads.homeId,
        threadId: threads.id,
        roleKey: threads.roleKey,
        state: threads.state,
        hasSession: sql<boolean>`${threads.session} is not null`,
        holdsOpenDecision: sql<boolean>`exists (select 1 from ${decisions} where ${and(eq(decisions.threadId, threads.id), unanswered)})`,
        lastPersonMessageAt: sql<Date | null>`${newestOfKind("person", logged.at)}`.mapWith(
          threads.startedAt,
        ),
        personSpokeLast: sql<boolean>`coalesce(${newestOfKind("person", logged.position)}, 0) > coalesce(${newestOfKind("user", logged.position)}, 0)`,
      })
      .from(threads)
      .where(
        and(
          eq(threads.homeKind, "initiative"),
          inArray(threads.homeId, [...initiativeIds]),
          isNull(threads.consultation),
        ),
      )
      .orderBy(threads.homeId, desc(threads.startedAt), desc(threads.id));
    return rows.map(({ lastPersonMessageAt, ...row }) => ({
      ...row,
      lastPersonMessageAt: lastPersonMessageAt ?? undefined,
    }));
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
      const {
        change: proposed,
        status,
        statusAt,
        statusBy,
        declinedBecause,
      } = toProposalRow(changed.proposal);
      await transaction
        .update(proposals)
        .set({ change: proposed, status, statusAt, statusBy, declinedBecause })
        .where(eq(proposals.id, id));
      return changed;
    });
  }

  async markProposalOutOfDate(id: string): Promise<void> {
    await this.database
      .update(proposals)
      .set({ change: sql`${proposals.change} || jsonb_build_object('outOfDate', true)` })
      .where(and(eq(proposals.id, id), eq(proposals.status, "open")));
  }
}

/** The Threads of `rows`, in their order, each with the Decisions it waits on, the first asked first. */
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
        unanswered,
      ),
    )
    .orderBy(asc(decisions.askedAt), asc(decisions.id));
  const decisionsOf = (thread: ThreadRow): Decision[] =>
    open
      .filter((row) => row.threadId === thread.id)
      .map((decision) => toDecision({ decision, inStageThread: thread.stageThread }));
  return rows.map((row) => toThread(row, decisionsOf(row)));
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

/** The condition a message logged in the range meets, its Thread joined. */
function loggedInRange({
  from,
  to,
  roleKey,
  homes,
  threadId,
}: LoggedMessagesRange): SQL | undefined {
  return and(
    gte(threadMessages.at, from),
    lte(threadMessages.at, to),
    roleKey === undefined ? undefined : eq(threads.roleKey, roleKey),
    homes === undefined ? undefined : or(...homes.map(inHome)),
    threadId === undefined ? undefined : eq(threadMessages.threadId, threadId),
  );
}

/** The condition a Thread in the home meets. */
function inHome(home: Home): SQL | undefined {
  const { kind, id } = homeColumns(home);
  return and(eq(threads.homeKind, kind), eq(threads.homeId, id));
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
    stageContextLimits: thread.stageContextLimits ?? null,
  };
}

function toThread(row: ThreadRow, openDecisions: readonly Decision[]): Thread {
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
    openDecisions,
    stageThread: row.stageThread,
    consultation: row.consultation ?? undefined,
    stageContextLimits: row.stageContextLimits ?? undefined,
  };
}

function toSessionRow(session: ThreadSession): ThreadSessionRow {
  return {
    ...session,
    startedAt: session.startedAt.toISOString(),
    lastCallAt: session.lastCallAt?.toISOString() ?? null,
    startContextTokens: session.startContextTokens ?? null,
    heldDuties: session.heldDuties,
  };
}

function toSession(row: ThreadSessionRow): ThreadSession {
  return {
    ...row,
    startedAt: new Date(row.startedAt),
    lastCallAt: row.lastCallAt === null ? undefined : new Date(row.lastCallAt),
    startContextTokens: row.startContextTokens ?? undefined,
    changesAllowed: row.changesAllowed ?? false,
    officeInstructionsVersion: row.officeInstructionsVersion ?? NO_OFFICE_INSTRUCTIONS.version,
    heldDuties: row.heldDuties,
  };
}

/**
 * The message as kept: a Decision's answer line keeps the answer as one, from the Decision it
 * answers among `asked`, beside the form's answer.
 */
function toMessageRow(
  { id, threadId, at, ...draft }: Message,
  asked: readonly Decision[],
): Omit<MessageRow, "position"> {
  if (draft.kind !== "decision-answer") return { id, threadId, at, body: draft };
  const { answer, ...line } = draft;
  const decision = asked.find((one) => one.id === draft.decisionId) ?? UNKNOWN_FORM;
  return {
    id,
    threadId,
    at,
    body: {
      ...line,
      answer: oneAnswerView(decision, answer),
      formAnswer: toSavedFormAnswer(answer, decision.questions),
    },
  };
}

/** A Decision not among those at hand, read as a form of no questions: its answer reads alone. */
const UNKNOWN_FORM: Pick<Decision, "kind" | "questions"> = { kind: "form", questions: [] };

function toMessage({ body, id, threadId, at }: MessageRow): Message {
  return { ...toMessageDraft(body), id, threadId, at };
}

/** The message as kept, with a line kept before the form read as the answer to one question. */
function toMessageDraft(body: SavedMessage): MessageDraft {
  if (body.kind !== "decision-answer") return body;
  const { answer, formAnswer, ...line } = body;
  return {
    ...line,
    answer: formAnswer ? fromSavedFormAnswer(formAnswer) : formAnswerFromOne(answer),
  };
}

/** What a Decision is saved as; the approval it gave a held call is spent apart from it. */
type SavedDecision = Omit<DecisionRow, "approvalSpentAt">;

/**
 * The Decision as kept: its form in `questions` and `form_answer`, and the form as one question in
 * the columns the release before reads (spec: migrations keep the previous release working).
 */
function toDecisionRow({
  answer,
  taskId,
  roleKey,
  putTo,
  passedOn,
  closedAt,
  kind,
  questions,
  inStageThread: _inStageThread,
  bugTask,
  ...fields
}: Decision): SavedDecision {
  const decision = {
    ...fields,
    bugTask: bugTask ?? null,
    ...oneQuestionView({ questions }),
    kind: oneQuestionKind(kind),
    questions: toSavedQuestions(questions),
    closedAt: closedAt ?? null,
    taskId: taskId ?? null,
    roleKey: roleKey ?? null,
    putTo: putTo ?? null,
    passedOn: passedOn.map(({ passedOnAt, ...passing }) => ({
      ...passing,
      passedOnAt: passedOnAt.toISOString(),
    })),
  };
  if (!answer) return { ...decision, answer: null, formAnswer: null, answeredAt: null };
  const { answeredAt, user, answeredBy, atUsersRequest, byTheOffice, ...formAnswer } = answer;
  const givenBy = {
    ...(user === undefined ? {} : { user }),
    ...(answeredBy === undefined ? {} : { answeredBy }),
    ...(atUsersRequest === undefined ? {} : { atUsersRequest }),
    ...(byTheOffice === undefined ? {} : { byTheOffice }),
  };
  return {
    ...decision,
    answer: { ...oneAnswerView({ kind, questions }, formAnswer), ...givenBy },
    formAnswer: toSavedFormAnswer(formAnswer, questions),
    answeredAt,
  };
}

/**
 * A Decision as read: its row, and whether its Thread is a Stage Thread, which no column of its own
 * keeps (spec: migrations keep the previous release working).
 */
const DECISION_READ = { decision: decisions, inStageThread: threads.stageThread };

interface DecisionRead {
  readonly decision: DecisionRow;
  readonly inStageThread: boolean;
}

function toDecision({
  decision: {
    answer,
    answeredAt,
    taskId,
    roleKey,
    putTo,
    passedOn,
    closedAt,
    approvalSpentAt: _approvalSpentAt,
    kind,
    question,
    options,
    recommendation,
    questions,
    formAnswer,
    bugTask,
    ...row
  },
  inStageThread,
}: DecisionRead): Decision {
  const asked = formFromOne(kind, { question, options, recommendation });
  return {
    ...row,
    inStageThread,
    ...(bugTask === null ? { kind: asked.kind } : { kind: "bug-task", bugTask }),
    questions: questions ? fromSavedQuestions(questions) : asked.questions,
    ...(closedAt === null ? {} : { closedAt }),
    taskId: taskId ?? undefined,
    roleKey: roleKey ?? undefined,
    putTo: putTo ?? undefined,
    passedOn: passedOn.map(({ passedOnAt, ...passing }) => ({
      ...passing,
      passedOnAt: new Date(passedOnAt),
    })),
    answer:
      answer === null || answeredAt === null
        ? undefined
        : toGivenAnswer(answer, formAnswer, answeredAt),
  };
}

/** The answer given, its form's answer read from the one kept before the form when it has none. */
function toGivenAnswer(
  { user, answeredBy, atUsersRequest, byTheOffice, ...one }: NonNullable<DecisionRow["answer"]>,
  formAnswer: DecisionRow["formAnswer"],
  answeredAt: Date,
): GivenAnswer {
  return {
    ...(formAnswer ? fromSavedFormAnswer(formAnswer) : formAnswerFromOne(one)),
    ...(user === undefined ? {} : { user }),
    ...(answeredBy === undefined ? {} : { answeredBy }),
    ...(atUsersRequest === undefined ? {} : { atUsersRequest }),
    ...(byTheOffice === undefined ? {} : { byTheOffice }),
    answeredAt,
  };
}

function toProposalRow({ status, change, ...proposal }: Proposal): ProposalRow {
  return {
    ...proposal,
    change: toStoredChange(change),
    status: status.kind,
    statusAt: status.kind === "open" ? null : status.at,
    statusBy: status.kind === "open" ? null : status.by,
    declinedBecause: status.kind === "declined" ? (status.because ?? null) : null,
  };
}

function toProposal({
  status,
  statusAt,
  statusBy,
  declinedBecause,
  change,
  ...row
}: ProposalRow): Proposal {
  return {
    ...row,
    change: toProposedChange(change),
    status: toProposalStatus(status, statusAt, statusBy, declinedBecause),
  };
}

function toProposedChange(change: Proposal["change"]): Proposal["change"] {
  switch (change.kind) {
    // A hire not applied yet has no Role key, which its JSON leaves out.
    case "hire": {
      const roleKey = change.roleKey ?? undefined;
      return {
        ...change,
        card: cardFromStored(change.card, roleKey ?? hiredKeyOf(change)),
        roleKey,
      };
    }
    case "office-setup":
      return {
        ...change,
        hires: change.hires.map((hire) =>
          hire.kind === "hire"
            ? { ...hire, card: cardFromStored(hire.card, hiredKeyOf(hire)) }
            : hire,
        ),
      };
    case "change": {
      const from = fieldsFromStored(change.from, change.roleKey, {});
      return {
        ...change,
        from,
        to: fieldsFromStored(change.to, change.roleKey, from.authority ?? {}),
      };
    }
    // A Proposal of commands drafted before re-run commands has none, read as blank.
    case "project-commands":
      return {
        ...change,
        changes: {
          ...change.changes,
          commands: change.changes.commands.map(({ key, from, to }) => ({
            key,
            from: from && withRerunCommandLine(from),
            to: to && withRerunCommandLine(to),
          })),
        },
      };
    // A Proposal of test targets drafted before commands before the entry point, the port
    // variable and a target's memory has none of them, read as their defaults.
    case "test-targets":
      return {
        ...change,
        changes: {
          ...change.changes,
          targets: change.changes.targets.map((target) => ({
            ...target,
            from: target.from && withTargetDefaults(target.from),
            to: target.to && withTargetDefaults(target.to),
          })),
        },
      };
    // A Proposal of Actions drafted before a Project command Action's device has none, read as null.
    case "actions":
      return {
        ...change,
        changes: {
          ...change.changes,
          actions: change.changes.actions.map((action) => ({
            ...action,
            from: action.from && withActionDefaults(action.from),
            to: action.to && withActionDefaults(action.to),
          })),
        },
      };
    default:
      return change;
  }
}

function withActionDefaults(fields: ActionFields): ActionFields {
  if (fields.kind !== "project-command") return fields;
  // The row's JSON may lack it, whatever the type says.
  const stored: { readonly projectDeviceId?: string | null } = fields.settings;
  return {
    ...fields,
    settings: { ...fields.settings, projectDeviceId: stored.projectDeviceId ?? null },
  };
}

/** A card, or a change's fields, as a Proposal's JSON holds them: Hard switches beside Authority. */
type StoredCardFields = RoleCardFields & { readonly hardSwitches?: Partial<HardSwitches> };

/** A whole card as a Proposal's JSON holds it, which may lack the Authority whatever the type says. */
type StoredCard = Omit<RoleCard, "authority"> & {
  readonly authority?: Authority;
  readonly hardSwitches?: Partial<HardSwitches>;
};

/**
 * The change as it is stored: each Role card it holds, or change's fields with an Authority, carries
 * its Hard switches as well (`hardSwitchesOf`), so the release before Authority reads an open
 * Proposal as it reads it.
 */
function toStoredChange(change: Proposal["change"]): Proposal["change"] {
  switch (change.kind) {
    case "hire":
      return {
        ...change,
        card: withHardSwitches(change.card, change.roleKey ?? hiredKeyOf(change)),
      };
    case "office-setup":
      return {
        ...change,
        hires: change.hires.map((hire) =>
          hire.kind === "hire"
            ? { ...hire, card: withHardSwitches(hire.card, hiredKeyOf(hire)) }
            : hire,
        ),
      };
    case "change":
      return {
        ...change,
        from: withHardSwitches(change.from, change.roleKey),
        to: withHardSwitches(change.to, change.roleKey),
      };
    default:
      return change;
  }
}

function withHardSwitches<Card extends StoredCardFields>(card: Card, roleKey: string): Card {
  if (card.authority === undefined) return card;
  const stored: Card & StoredCardFields = {
    ...card,
    hardSwitches: hardSwitchesOf(roleKey, card.authority),
  };
  return stored;
}

/**
 * A card a Proposal holds, as the domain reads it: its Authority, or one made from the Hard switches
 * an earlier release drafted it with, a missing switch read as Ask me (`authorityWithHardSwitches`).
 */
function cardFromStored(card: StoredCard, roleKey: string): RoleCard {
  const { hardSwitches, authority, ...rest } = card;
  return {
    ...rest,
    authority: authority ?? authorityWithHardSwitches(roleKey, {}, hardSwitches ?? {}),
  };
}

/**
 * A change's fields as the domain reads them: an Authority made from the Hard switches an earlier
 * release drafted them with, over `base`, when they rewrote the switches and give no Authority.
 */
function fieldsFromStored(
  fields: RoleCardFields,
  roleKey: string,
  base: Authority,
): RoleCardFields {
  const stored: StoredCardFields = fields;
  const { hardSwitches, ...rest } = stored;
  if (stored.authority !== undefined || hardSwitches === undefined) return rest;
  return { ...rest, authority: authorityWithHardSwitches(roleKey, base, hardSwitches) };
}

function withTargetDefaults(fields: ProposedTestTargetFields): ProposedTestTargetFields {
  // The row's JSON may lack them, whatever the type says.
  if (fields.kind === "install-on-a-device") return fields;
  const stored: {
    readonly commandsBefore?: readonly string[];
    readonly portVariable?: string;
    readonly memoryMegabytes?: number | null;
  } = fields;
  const common = {
    commandsBefore: stored.commandsBefore ?? [],
    memoryMegabytes: stored.memoryMegabytes ?? null,
  };
  return fields.kind === "build-to-install"
    ? { ...fields, ...common }
    : { ...fields, ...common, portVariable: stored.portVariable ?? DEFAULT_PORT_VARIABLE };
}

function withRerunCommandLine(
  command: Omit<ProjectCommandFields, "rerunCommandLine"> & { readonly rerunCommandLine?: string },
): ProjectCommandFields {
  return { ...command, rerunCommandLine: command.rerunCommandLine ?? "" };
}

function toProposalStatus(
  kind: ProposalStatus["kind"],
  at: Date | null,
  by: UserRef | null,
  because: ProposalDeclinedBecause | null,
): ProposalStatus {
  if (kind === "open") return { kind };
  if (!at) throw new Error(`A ${kind} Proposal has no time it was ${kind}.`);
  if (kind === "declined" && because) return { kind, at, by, because };
  return { kind, at, by };
}
