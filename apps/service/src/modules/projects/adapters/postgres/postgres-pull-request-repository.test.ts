import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { aProject } from "../../domain/project.fixtures.js";
import { openedPullRequest, type PullRequest } from "../../domain/pull-request.js";
import { PostgresProjectRepository } from "./postgres-project-repository.js";
import { PostgresPullRequestRepository } from "./postgres-pull-request-repository.js";

let app: INestApplication;
let repository: PostgresPullRequestRepository;
let projectId: string;
/** This file's own remote: every test file shares the database. */
const remoteUrl = `https://github.com/office/${randomUUID()}.git`;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresProjectRepository, PostgresPullRequestRepository],
  }));
  repository = app.get(PostgresPullRequestRepository);
  projectId = `project-${randomUUID()}`;
  await app.get(PostgresProjectRepository).add(aProject({ id: projectId }));
});

afterAll(async () => {
  await app.close();
});

function aPullRequest(number: number, openedAt: Date): PullRequest {
  return openedPullRequest({
    id: randomUUID(),
    projectId,
    taskId: randomUUID(),
    remoteUrl,
    number,
    url: `https://github.com/office/tools/pull/${number}`,
    title: `Pull request ${number}`,
    branch: `office/${randomUUID()}`,
    baseBranch: "main",
    openedAt,
  });
}

describe("PostgresPullRequestRepository", () => {
  it("keeps a pull request, lists the open ones newest first and saves its status", async () => {
    const older = await repository.record(aPullRequest(1, new Date("2026-11-01T10:00:00Z")));
    const newer = await repository.record(aPullRequest(2, new Date("2026-11-02T10:00:00Z")));

    await expect(repository.listOpen(projectId)).resolves.toEqual([newer, older]);

    const read: PullRequest = {
      ...older,
      state: "merged",
      checks: "passing",
      mergeable: "yes",
      headCommit: "a".repeat(40),
      baseCommit: "b".repeat(40),
      checkedAt: new Date("2026-11-03T10:00:00Z"),
      endedAt: new Date("2026-11-03T10:00:00Z"),
    };
    await repository.save(read);

    await expect(repository.listOpen(projectId)).resolves.toEqual([newer]);
    await expect(repository.find(remoteUrl, 1)).resolves.toEqual(read);
  });

  it("updates the one kept for the same remote and number instead of keeping it twice", async () => {
    const first = await repository.record(aPullRequest(3, new Date("2026-11-04T10:00:00Z")));
    await repository.save({ ...first, checks: "failing", checkedAt: new Date() });

    const again = await repository.record({
      ...aPullRequest(3, new Date("2026-11-05T10:00:00Z")),
      title: "Renamed",
    });

    expect(again).toMatchObject({ id: first.id, title: "Renamed", checks: "failing" });
    const listed = (await repository.listOpen(projectId)).filter((one) => one.number === 3);
    expect(listed).toEqual([again]);
  });
});
