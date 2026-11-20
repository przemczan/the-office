import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { IssueLink, IssueWriteBackEntry } from "../../domain/issue-link.js";
import { IssueLinkRepository } from "../../ports/issue-link-repository.js";
import { issueLinks, issueWriteBacks } from "./issue-links.schema.js";

type IssueLinkRow = typeof issueLinks.$inferSelect;
type IssueWriteBackRow = typeof issueWriteBacks.$inferSelect;

@Injectable()
export class PostgresIssueLinkRepository extends IssueLinkRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async claim(link: IssueLink): Promise<boolean> {
    // The unique remote and number decide between two imports at once: the second inserts nothing.
    const rows = await this.database
      .insert(issueLinks)
      .values(toRow(link))
      .onConflictDoNothing({ target: [issueLinks.remoteUrl, issueLinks.number] })
      .returning({ id: issueLinks.id });
    return rows.length > 0;
  }

  async attachTask(id: string, taskId: string): Promise<void> {
    await this.database.update(issueLinks).set({ taskId }).where(eq(issueLinks.id, id));
  }

  async release(id: string): Promise<void> {
    await this.database
      .delete(issueLinks)
      .where(and(eq(issueLinks.id, id), isNull(issueLinks.taskId)));
  }

  async ofTask(taskId: string): Promise<IssueLink | undefined> {
    const [row] = await this.database
      .select()
      .from(issueLinks)
      .where(eq(issueLinks.taskId, taskId))
      .limit(1);
    return row && toLink(row);
  }

  async ofTasks(taskIds: readonly string[]): Promise<readonly IssueLink[]> {
    if (taskIds.length === 0) return [];
    const rows = await this.database
      .select()
      .from(issueLinks)
      .where(inArray(issueLinks.taskId, [...taskIds]))
      .orderBy(asc(issueLinks.number));
    return rows.map(toLink);
  }

  async linkedNumbers(remoteUrl: string): Promise<ReadonlySet<number>> {
    const rows = await this.database
      .select({ number: issueLinks.number })
      .from(issueLinks)
      .where(eq(issueLinks.remoteUrl, remoteUrl));
    return new Set(rows.map(({ number }) => number));
  }

  async watched(projectId: string): Promise<readonly IssueLink[]> {
    const rows = await this.database
      .select()
      .from(issueLinks)
      .where(
        and(
          eq(issueLinks.projectId, projectId),
          isNotNull(issueLinks.taskId),
          isNull(issueLinks.taskEndedAt),
        ),
      )
      .orderBy(asc(issueLinks.number));
    return rows.map(toLink);
  }

  async markChecked(id: string, closedOnHostAt: Date | null, checkedAt: Date): Promise<void> {
    await this.database
      .update(issueLinks)
      .set({ closedOnHostAt, checkedAt })
      .where(eq(issueLinks.id, id));
  }

  async endTask(id: string, at: Date): Promise<void> {
    await this.database
      .update(issueLinks)
      .set({ taskEndedAt: at })
      .where(and(eq(issueLinks.id, id), isNull(issueLinks.taskEndedAt)));
  }

  async addWriteBacks(entries: readonly IssueWriteBackEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.database.insert(issueWriteBacks).values([...entries]);
  }

  async pendingWriteBacks(issueLinkId: string): Promise<readonly IssueWriteBackEntry[]> {
    const rows = await this.database
      .select()
      .from(issueWriteBacks)
      .where(and(eq(issueWriteBacks.issueLinkId, issueLinkId), isNull(issueWriteBacks.doneAt)))
      .orderBy(asc(issueWriteBacks.createdAt), asc(issueWriteBacks.id));
    return rows.map(toWriteBack);
  }

  async withPendingWriteBacks(projectId: string, since: Date): Promise<readonly IssueLink[]> {
    const rows = await this.database
      .selectDistinct({ link: issueLinks })
      .from(issueLinks)
      .innerJoin(issueWriteBacks, eq(issueWriteBacks.issueLinkId, issueLinks.id))
      .where(
        and(
          eq(issueLinks.projectId, projectId),
          isNull(issueWriteBacks.doneAt),
          gte(issueWriteBacks.createdAt, since),
        ),
      );
    return rows.map(({ link }) => toLink(link));
  }

  async writeBackDone(id: string, at: Date): Promise<void> {
    await this.database
      .update(issueWriteBacks)
      .set({ doneAt: at })
      .where(eq(issueWriteBacks.id, id));
  }

  async writeBackFailed(id: string, problem: string): Promise<void> {
    const [row] = await this.database
      .select({ tries: issueWriteBacks.tries })
      .from(issueWriteBacks)
      .where(eq(issueWriteBacks.id, id));
    if (!row) return;
    await this.database
      .update(issueWriteBacks)
      .set({ tries: row.tries + 1, lastProblem: problem })
      .where(eq(issueWriteBacks.id, id));
  }

  async writeBackProblemOf(issueLinkId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ lastProblem: issueWriteBacks.lastProblem })
      .from(issueWriteBacks)
      .where(
        and(
          eq(issueWriteBacks.issueLinkId, issueLinkId),
          isNull(issueWriteBacks.doneAt),
          isNotNull(issueWriteBacks.lastProblem),
        ),
      )
      .orderBy(desc(issueWriteBacks.createdAt))
      .limit(1);
    return row?.lastProblem ?? null;
  }
}

function toRow(link: IssueLink): IssueLinkRow {
  const { author, ...rest } = link;
  return { ...rest, authorLogin: author.login, authorUrl: author.url };
}

function toLink({ authorLogin, authorUrl, ...row }: IssueLinkRow): IssueLink {
  return { ...row, author: { login: authorLogin, url: authorUrl } };
}

function toWriteBack(row: IssueWriteBackRow): IssueWriteBackEntry {
  return { ...row };
}
