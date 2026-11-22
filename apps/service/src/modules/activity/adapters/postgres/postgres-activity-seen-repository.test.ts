import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { PostgresActivitySeenRepository } from "./postgres-activity-seen-repository.js";

let database: FreshTestDatabase;
let app: INestApplication;
let repository: PostgresActivitySeenRepository;

// A database of its own: forgetting is for every user at once, so on the shared one it would
// forget other files' seen items, and theirs this file's.
beforeAll(async () => {
  database = await freshTestDatabase();
  ({ app } = await startTestApplication({
    database: { url: database.url },
    providers: [PostgresActivitySeenRepository],
  }));
  repository = app.get(PostgresActivitySeenRepository);
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

describe("PostgresActivitySeenRepository", () => {
  it("keeps each user's seen items apart, once each", async () => {
    const ann = randomUUID();
    const ben = randomUUID();
    const at = new Date("2026-11-21T12:00:00Z");

    await repository.markSeen(ann, ["ci-run:office:41:1:ended", "ci-run:office:41:1:ended"], at);
    await repository.markSeen(ben, ["task:t1:done"], at);
    await repository.markSeen(ann, ["task:t1:done"], at);

    expect(await repository.seenOf(ann)).toEqual(
      new Set(["ci-run:office:41:1:ended", "task:t1:done"]),
    );
    expect(await repository.seenOf(ben)).toEqual(new Set(["task:t1:done"]));
    expect(await repository.seenOf(randomUUID())).toEqual(new Set());
  });

  it("forgets what was seen before the cut, keeping an item seen again later", async () => {
    const user = randomUUID();
    const old = new Date("2026-09-01T00:00:00Z");
    const cut = new Date("2026-10-01T00:00:00Z");
    const recent = new Date("2026-11-01T00:00:00Z");
    await repository.markSeen(user, ["forgotten", "seen-again"], old);
    await repository.markSeen(user, ["seen-again"], recent);
    await repository.markSeen(user, ["kept"], recent);
    // Seeing again never takes the time back.
    await repository.markSeen(user, ["seen-again"], old);

    await repository.forgetBefore(cut);

    expect(await repository.seenOf(user)).toEqual(new Set(["seen-again", "kept"]));
  });
});
