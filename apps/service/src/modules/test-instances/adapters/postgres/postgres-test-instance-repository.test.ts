import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import {
  built,
  failed,
  filesRemoved,
  launchedInstance,
  startedRunning,
  stopped,
  type TestInstance,
} from "../../domain/test-instance.js";
import { PostgresTestInstanceRepository } from "./postgres-test-instance-repository.js";

let app: INestApplication;
let repository: PostgresTestInstanceRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresTestInstanceRepository],
  }));
  repository = app.get(PostgresTestInstanceRepository);
});

afterAll(async () => {
  await app.close();
});

/** An instance of this file's own Initiative, on a port no other file's rows hold. */
function anInstance(initiativeId: string, port: number, at: Date): TestInstance {
  return launchedInstance({
    id: randomUUID(),
    initiativeId,
    projectId: "shop",
    branch: "initiative/checkout",
    targetKey: "web",
    targetName: "Web app",
    kind: "hosted",
    port,
    launchedBy: { kind: "user", user: { userId: "user-ann", name: "Ann Lee" } },
    at,
  });
}

describe("PostgresTestInstanceRepository", () => {
  it("keeps an instance through its states, lists the Initiative's newest first and the active ones", async () => {
    const initiativeId = randomUUID();
    const older = anInstance(initiativeId, 61_001, new Date("2003-01-01T10:00:00Z"));
    const newer = anInstance(initiativeId, 61_002, new Date("2003-01-01T11:00:00Z"));
    await repository.add(older);
    await repository.add(newer);

    expect(await repository.find(older.id)).toEqual(older);
    expect((await repository.listOf(initiativeId)).map(({ id }) => id)).toEqual([
      newer.id,
      older.id,
    ]);

    const running = await repository.update(older.id, (kept) =>
      startedRunning(kept, new Date("2003-01-01T10:01:00Z")),
    );
    expect(running?.event).toMatchObject({ from: "building", to: "running", port: 61_001 });
    await repository.update(older.id, (kept) => ({
      instance: { ...kept, commit: "c0ffee" },
      event: undefined,
    }));
    await repository.update(newer.id, (kept) =>
      failed(kept, "The app didn't answer on port 3000.", new Date("2003-01-01T11:02:00Z")),
    );

    const active = (await repository.active()).filter((each) => each.initiativeId === initiativeId);
    expect(active).toEqual([
      { ...older, state: "running", commit: "c0ffee", runningAt: new Date("2003-01-01T10:01:00Z") },
    ]);
    expect(await repository.find(newer.id)).toMatchObject({
      state: "failed",
      port: undefined,
      failedReason: "The app didn't answer on port 3000.",
      endedAt: new Date("2003-01-01T11:02:00Z"),
    });

    await repository.update(older.id, (kept) =>
      stopped(kept, "Stopped by you.", new Date("2003-01-01T12:00:00Z")),
    );
    expect(
      await repository.update(older.id, (kept) => stopped(kept, "Stopped by you.", new Date())),
    ).toBeUndefined();
    expect(
      await repository.update(randomUUID(), (kept) => stopped(kept, "Stopped by you.", new Date())),
    ).toBeUndefined();
  });

  it("keeps an instance linked to no Initiative with its branch, and lists the Project's, linked or not, newest first", async () => {
    const projectId = `project-${randomUUID()}`;
    const initiativeId = randomUUID();
    const given = {
      projectId,
      targetKey: "android",
      targetName: "Android app",
      kind: "build-to-install",
      launchedBy: { kind: "user", user: { userId: "user-ann", name: "Ann Lee" } },
    } as const;
    const unlinked = launchedInstance({
      ...given,
      id: randomUUID(),
      initiativeId: undefined,
      branch: "feature/login",
      at: new Date("2003-03-01T10:00:00Z"),
    });
    const linked = launchedInstance({
      ...given,
      id: randomUUID(),
      initiativeId,
      branch: "initiative/checkout",
      at: new Date("2003-03-01T11:00:00Z"),
    });
    const otherBranch = launchedInstance({
      ...given,
      id: randomUUID(),
      initiativeId: undefined,
      branch: "feature/search",
      at: new Date("2003-03-01T12:00:00Z"),
    });
    for (const instance of [unlinked, linked, otherBranch]) {
      await repository.add(instance);
      await repository.update(instance.id, (kept) =>
        built(kept, BUILT_FILES, new Date("2003-03-02T10:00:00Z")),
      );
    }

    expect(await repository.find(unlinked.id)).toMatchObject({
      initiativeId: undefined,
      branch: "feature/login",
    });
    expect((await repository.listOfProject(projectId)).map(({ id }) => id)).toEqual([
      otherBranch.id,
      linked.id,
      unlinked.id,
    ]);
    const onBranch = { projectId, targetKey: "android", branch: "feature/login" };
    expect((await repository.builtWithFiles(onBranch)).map(({ id }) => id)).toEqual([unlinked.id]);
    const onInitiative = { projectId, targetKey: "android", initiativeId };
    expect((await repository.builtWithFiles(onInitiative)).map(({ id }) => id)).toEqual([
      linked.id,
    ]);
  });

  const BUILT_FILES = [
    { name: "app.apk", size: 4404019 },
    { name: "app-2.apk", size: 0 },
  ];
  it("keeps a Built instance's files, and lists the builds with files kept, newest first", async () => {
    const initiativeId = randomUUID();
    const aBuild = (targetKey: string, at: string): TestInstance =>
      launchedInstance({
        id: randomUUID(),
        initiativeId,
        projectId: "shop",
        branch: "initiative/checkout",
        targetKey,
        targetName: "Android app",
        kind: "build-to-install",
        launchedBy: { kind: "user", user: { userId: "user-ann", name: "Ann Lee" } },
        at: new Date(at),
      });
    const older = aBuild("android", "2003-02-01T10:00:00Z");
    const newer = aBuild("android", "2003-02-01T11:00:00Z");
    const removed = aBuild("android", "2003-02-01T12:00:00Z");
    const otherTarget = aBuild("wear", "2003-02-01T13:00:00Z");
    const building = aBuild("android", "2003-02-01T14:00:00Z");
    for (const build of [older, newer, removed, otherTarget, building]) {
      await repository.add(build);
      expect(build.port).toBeUndefined();
    }
    for (const build of [older, newer, removed, otherTarget]) {
      await repository.update(build.id, (kept) =>
        built(kept, BUILT_FILES, new Date("2003-02-02T10:00:00Z")),
      );
    }
    await repository.update(removed.id, (kept) =>
      filesRemoved(kept, new Date("2003-02-03T10:00:00Z")),
    );

    expect(await repository.find(newer.id)).toMatchObject({
      state: "built",
      files: BUILT_FILES,
      filesRemovedAt: undefined,
    });
    expect(await repository.find(removed.id)).toMatchObject({
      files: BUILT_FILES,
      filesRemovedAt: new Date("2003-02-03T10:00:00Z"),
    });
    const target = { initiativeId, projectId: "shop", targetKey: "android" };
    expect((await repository.builtWithFiles(target)).map(({ id }) => id)).toEqual([
      newer.id,
      older.id,
    ]);
    const everywhere = (await repository.builtWithFiles()).filter(
      (each) => each.initiativeId === initiativeId,
    );
    expect(everywhere.map(({ id }) => id)).toEqual([otherTarget.id, newer.id, older.id]);
    expect((await repository.active()).map(({ id }) => id)).toContain(building.id);
  });

  it("lists the instances Built or Failed since a time, newest first, across Initiatives", async () => {
    const initiativeId = randomUUID();
    const base = anInstance(initiativeId, 61_020, new Date("2004-01-01T09:00:00Z"));
    const aBuild = (at: string): TestInstance => ({
      ...base,
      id: randomUUID(),
      port: undefined,
      kind: "build-to-install",
      launchedAt: new Date(at),
    });
    const early = aBuild("2004-01-01T09:00:00Z");
    const late = aBuild("2004-01-01T09:10:00Z");
    const failing = aBuild("2004-01-01T09:20:00Z");
    const stillBuilding = aBuild("2004-01-01T09:30:00Z");
    const stoppedOne = anInstance(initiativeId, 61_021, new Date("2004-01-01T09:40:00Z"));
    for (const each of [early, late, failing, stillBuilding, stoppedOne])
      await repository.add(each);
    await repository.update(early.id, (kept) => built(kept, [], new Date("2004-01-02T10:00:00Z")));
    await repository.update(late.id, (kept) => built(kept, [], new Date("2004-01-02T12:00:00Z")));
    await repository.update(failing.id, (kept) =>
      failed(kept, "The build failed.", new Date("2004-01-02T11:00:00Z")),
    );
    await repository.update(stoppedOne.id, (kept) =>
      stopped(kept, "Stopped by you.", new Date("2004-01-02T13:00:00Z")),
    );

    const since = async (at: string): Promise<string[]> =>
      (await repository.endedSince(new Date(at)))
        .filter((each) => each.initiativeId === initiativeId)
        .map(({ id }) => id);
    expect(await since("2004-01-02T10:00:00Z")).toEqual([late.id, failing.id, early.id]);
    expect(await since("2004-01-02T10:30:00Z")).toEqual([late.id, failing.id]);
    expect(await since("2004-01-03T00:00:00Z")).toEqual([]);
  });

  it("refuses two active instances on one Proxy port", async () => {
    const initiativeId = randomUUID();
    const first = anInstance(initiativeId, 61_010, new Date());
    await repository.add(first);

    await expect(
      repository.add(anInstance(initiativeId, 61_010, new Date())),
    ).rejects.toMatchObject({ cause: { constraint: "test_instances_active_port" } });
    await repository.update(first.id, (kept) => stopped(kept, "Stopped by you.", new Date()));
    await repository.add(anInstance(initiativeId, 61_010, new Date()));
  });
});
