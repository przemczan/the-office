import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { IssueLink } from "../../domain/issue-link.js";
import { PostgresIssueLinkRepository } from "./postgres-issue-link-repository.js";

let app: INestApplication;
let repository: PostgresIssueLinkRepository;
/** This file's own Project and remote: every test file shares the database. */
const projectId = `project-${randomUUID()}`;
const remoteUrl = `https://github.com/office/${randomUUID()}.git`;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresIssueLinkRepository],
  }));
  repository = app.get(PostgresIssueLinkRepository);
});

afterAll(async () => {
  await app.close();
});

function aLink(number: number, fields: Partial<IssueLink> = {}): IssueLink {
  return {
    id: randomUUID(),
    projectId,
    remoteUrl,
    number,
    taskId: null,
    title: `Issue ${number}`,
    url: `https://github.com/office/tools/issues/${number}`,
    author: { login: "octocat", url: "https://github.com/octocat" },
    importedAt: new Date("2026-11-19T10:00:00Z"),
    importedBy: { kind: "user", user: { userId: "user-ann", name: "Ann" } },
    closedOnHostAt: null,
    taskEndedAt: null,
    checkedAt: null,
    ...fields,
  };
}

describe("PostgresIssueLinkRepository", () => {
  it("claims an issue once, even for two imports at once, and gives a claim back", async () => {
    const [one, other] = await Promise.all([
      repository.claim(aLink(1)),
      repository.claim(aLink(1, { importedBy: { kind: "office" } })),
    ]);
    expect([one, other].toSorted()).toEqual([false, true]);

    const claim = aLink(2);
    await repository.claim(claim);
    await repository.release(claim.id);
    expect(await repository.claim(aLink(2))).toBe(true);
    expect([...(await repository.linkedNumbers(remoteUrl))].toSorted()).toEqual([1, 2]);
  });

  it("names the Task, keeps the link once it ends, and never gives a link with a Task back", async () => {
    const link = aLink(3);
    const taskId = randomUUID();
    await repository.claim(link);
    await repository.attachTask(link.id, taskId);
    await repository.release(link.id);

    expect(await repository.ofTask(taskId)).toEqual({ ...link, taskId });
    expect((await repository.watched(projectId)).map(({ number }) => number)).toContain(3);

    const closedAt = new Date("2026-11-19T11:00:00Z");
    await repository.markChecked(link.id, closedAt, closedAt);
    await repository.endTask(link.id, closedAt);
    await repository.endTask(link.id, new Date("2026-11-20T11:00:00Z"));

    expect(await repository.ofTasks([taskId, randomUUID()])).toEqual([
      { ...link, taskId, closedOnHostAt: closedAt, checkedAt: closedAt, taskEndedAt: closedAt },
    ]);
    expect((await repository.watched(projectId)).map(({ number }) => number)).not.toContain(3);
  });

  it("keeps the outbox in order, with the last problem until the write-back goes through", async () => {
    const link = aLink(4, { taskId: randomUUID() });
    await repository.claim(link);
    const at = new Date("2026-11-19T12:00:00Z");
    const comment = {
      id: randomUUID(),
      issueLinkId: link.id,
      action: "comment" as const,
      body: "Closed: won't fix.",
      createdAt: at,
      doneAt: null,
      tries: 0,
      lastProblem: null,
    };
    const close = {
      ...comment,
      id: randomUUID(),
      action: "close" as const,
      body: "",
      createdAt: new Date(at.getTime() + 1),
    };
    await repository.addWriteBacks([comment, close]);

    await repository.writeBackFailed(comment.id, "GitHub couldn't be reached.");
    expect(
      (await repository.pendingWriteBacks(link.id)).map(({ id, tries }) => [id, tries]),
    ).toEqual([
      [comment.id, 1],
      [close.id, 0],
    ]);
    expect(await repository.writeBackProblemOf(link.id)).toBe("GitHub couldn't be reached.");
    expect((await repository.withPendingWriteBacks(projectId, at)).map(({ id }) => id)).toEqual([
      link.id,
    ]);

    await repository.writeBackDone(comment.id, at);
    await repository.writeBackDone(close.id, at);
    expect(await repository.pendingWriteBacks(link.id)).toEqual([]);
    expect(await repository.writeBackProblemOf(link.id)).toBeNull();
    expect(await repository.withPendingWriteBacks(projectId, at)).toEqual([]);
  });
});
