import type { IssueLink, IssueWriteBackEntry } from "../domain/issue-link.js";
import { IssueLinkRepository } from "./issue-link-repository.js";

/** The issue links and their outbox in memory, as Postgres keeps them. */
export class IssueLinkRepositoryForTests extends IssueLinkRepository {
  readonly links = new Map<string, IssueLink>();
  readonly writeBacks = new Map<string, IssueWriteBackEntry>();

  async claim(link: IssueLink): Promise<boolean> {
    const taken = [...this.links.values()].some(
      (each) => each.remoteUrl === link.remoteUrl && each.number === link.number,
    );
    if (taken) return false;
    this.links.set(link.id, link);
    return true;
  }

  async attachTask(id: string, taskId: string): Promise<void> {
    this.change(id, (link) => ({ ...link, taskId }));
  }

  async release(id: string): Promise<void> {
    if (this.links.get(id)?.taskId === null) this.links.delete(id);
  }

  async ofTask(taskId: string): Promise<IssueLink | undefined> {
    return [...this.links.values()].find((link) => link.taskId === taskId);
  }

  async ofTasks(taskIds: readonly string[]): Promise<readonly IssueLink[]> {
    return [...this.links.values()].filter(
      (link) => link.taskId !== null && taskIds.includes(link.taskId),
    );
  }

  async linkedNumbers(remoteUrl: string): Promise<ReadonlySet<number>> {
    return new Set(
      [...this.links.values()]
        .filter((link) => link.remoteUrl === remoteUrl)
        .map((link) => link.number),
    );
  }

  async watched(projectId: string): Promise<readonly IssueLink[]> {
    return [...this.links.values()].filter(
      (link) => link.projectId === projectId && link.taskId !== null && link.taskEndedAt === null,
    );
  }

  async markChecked(id: string, closedOnHostAt: Date | null, checkedAt: Date): Promise<void> {
    this.change(id, (link) => ({ ...link, closedOnHostAt, checkedAt }));
  }

  async endTask(id: string, at: Date): Promise<void> {
    this.change(id, (link) => (link.taskEndedAt === null ? { ...link, taskEndedAt: at } : link));
  }

  async addWriteBacks(entries: readonly IssueWriteBackEntry[]): Promise<void> {
    for (const entry of entries) this.writeBacks.set(entry.id, entry);
  }

  async pendingWriteBacks(issueLinkId: string): Promise<readonly IssueWriteBackEntry[]> {
    return [...this.writeBacks.values()]
      .filter((entry) => entry.issueLinkId === issueLinkId && entry.doneAt === null)
      .toSorted((one, other) => one.createdAt.getTime() - other.createdAt.getTime());
  }

  async withPendingWriteBacks(projectId: string, since: Date): Promise<readonly IssueLink[]> {
    const pending = new Set(
      [...this.writeBacks.values()]
        .filter((entry) => entry.doneAt === null && entry.createdAt >= since)
        .map((entry) => entry.issueLinkId),
    );
    return [...this.links.values()].filter(
      (link) => link.projectId === projectId && pending.has(link.id),
    );
  }

  async writeBackDone(id: string, at: Date): Promise<void> {
    const entry = this.writeBacks.get(id);
    if (entry) this.writeBacks.set(id, { ...entry, doneAt: at });
  }

  async writeBackFailed(id: string, problem: string): Promise<void> {
    const entry = this.writeBacks.get(id);
    if (entry) {
      this.writeBacks.set(id, { ...entry, tries: entry.tries + 1, lastProblem: problem });
    }
  }

  async writeBackProblemOf(issueLinkId: string): Promise<string | null> {
    const failed = (await this.pendingWriteBacks(issueLinkId)).filter(
      (entry) => entry.lastProblem !== null,
    );
    return failed.at(-1)?.lastProblem ?? null;
  }

  private change(id: string, change: (link: IssueLink) => IssueLink): void {
    const link = this.links.get(id);
    if (link) this.links.set(id, change(link));
  }
}
