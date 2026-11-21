import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import {
  failed,
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
    targetKey: "web",
    targetName: "Web app",
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

    await repository.update(older.id, (kept) => stopped(kept, new Date("2003-01-01T12:00:00Z")));
    expect(await repository.update(older.id, (kept) => stopped(kept, new Date()))).toBeUndefined();
    expect(
      await repository.update(randomUUID(), (kept) => stopped(kept, new Date())),
    ).toBeUndefined();
  });

  it("refuses two active instances on one Proxy port", async () => {
    const initiativeId = randomUUID();
    const first = anInstance(initiativeId, 61_010, new Date());
    await repository.add(first);

    await expect(
      repository.add(anInstance(initiativeId, 61_010, new Date())),
    ).rejects.toMatchObject({ cause: { constraint: "test_instances_active_port" } });
    await repository.update(first.id, (kept) => stopped(kept, new Date()));
    await repository.add(anInstance(initiativeId, 61_010, new Date()));
  });
});
