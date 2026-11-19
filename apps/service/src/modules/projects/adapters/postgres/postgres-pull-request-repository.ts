import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { PullRequest } from "../../domain/pull-request.js";
import { PullRequestRepository } from "../../ports/pull-request-repository.js";
import { pullRequests } from "./pull-requests.schema.js";

type PullRequestRow = typeof pullRequests.$inferSelect;

@Injectable()
export class PostgresPullRequestRepository extends PullRequestRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async record(pullRequest: PullRequest): Promise<PullRequest> {
    const [row] = await this.database
      .insert(pullRequests)
      .values(pullRequest)
      .onConflictDoUpdate({
        target: [pullRequests.remoteUrl, pullRequests.number],
        // What Publish knows anew; the status read last stays until the next read.
        set: {
          projectId: pullRequest.projectId,
          taskId: pullRequest.taskId,
          url: pullRequest.url,
          title: pullRequest.title,
          branch: pullRequest.branch,
          baseBranch: pullRequest.baseBranch,
          state: "open",
          endedAt: null,
        },
      })
      .returning();
    if (!row) throw new Error(`Pull request ${pullRequest.number} wasn't kept.`);
    return toPullRequest(row);
  }

  async save(pullRequest: PullRequest): Promise<void> {
    const { id, ...fields } = pullRequest;
    await this.database.update(pullRequests).set(fields).where(eq(pullRequests.id, id));
  }

  async listOpen(projectId?: string): Promise<readonly PullRequest[]> {
    const rows = await this.database
      .select()
      .from(pullRequests)
      .where(
        and(
          isNull(pullRequests.endedAt),
          projectId === undefined ? undefined : eq(pullRequests.projectId, projectId),
        ),
      )
      .orderBy(desc(pullRequests.openedAt), desc(pullRequests.number));
    return rows.map(toPullRequest);
  }

  async find(remoteUrl: string, number: number): Promise<PullRequest | undefined> {
    const [row] = await this.database
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.remoteUrl, remoteUrl), eq(pullRequests.number, number)));
    return row && toPullRequest(row);
  }
}

function toPullRequest(row: PullRequestRow): PullRequest {
  return { ...row };
}
