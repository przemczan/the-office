import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { freshChatThreadBrief, newChatThreadBrief, type BriefProject } from "../domain/brief.js";
import { logMessages } from "../domain/thread-changes.js";
import { aThread, aUserMessage } from "../domain/thread.fixtures.js";
import { BriefParts } from "../ports/brief-parts.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";

const PROJECTS: BriefProject[] = [
  { name: "Admin panel", baseBranch: "main", folder: "/office/bases/admin-panel" },
];

let app: INestApplication;
let briefs: Briefs;
let repository: ThreadRepository;

beforeAll(async () => {
  const parts: BriefParts = { projects: () => Promise.resolve(PROJECTS) };
  ({ app } = await startTestApplication({
    database: true,
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: BriefParts, useValue: parts },
      Briefs,
    ],
  }));
  briefs = app.get(Briefs);
  repository = app.get(ThreadRepository);
});

afterAll(async () => {
  await app.close();
});

describe("Briefs", () => {
  it("briefs a Thread nobody answered in yet as a new one", async () => {
    await expect(briefs.forChatThread(aThread({ id: randomUUID() }))).resolves.toEqual(
      newChatThreadBrief(PROJECTS),
    );
  });

  it("briefs a Thread with a session from its title and log", async () => {
    const thread = aThread({
      id: randomUUID(),
      session: {
        id: randomUUID(),
        roleKey: "planner",
        cardVersion: 1,
        startedAt: new Date("2026-10-25T09:00:00.000Z"),
        lastCallAt: new Date("2026-10-25T09:05:00.000Z"),
        contextTokens: 48_000,
      },
    });
    await repository.add(thread);
    const said = aUserMessage(thread, "Read the deploy workflow.");
    const { thread: titled } = await repository.update(thread.id, (current) =>
      logMessages(current, [said], new Date()),
    );

    await expect(briefs.forChatThread(titled)).resolves.toEqual(
      freshChatThreadBrief({ title: "Read the deploy workflow", log: [said], projects: PROJECTS }),
    );
  });
});
