import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { asc } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { EarlierRecords } from "../../../../platform/earlier-records/earlier-records.js";
import { aThread } from "../../domain/thread.fixtures.js";
import { BEN_ITO } from "../../domain/user.fixtures.js";
import { ConversationsEarlierRecords } from "./conversations-earlier-records.js";
import { officeInstructionsVersions } from "./office-instructions.schema.js";
import { PostgresThreadRepository } from "./postgres-thread-repository.js";
import { decisions, proposals, threadMessages, type SavedMessage } from "./threads.schema.js";

// A claim changes every row lacking a user, so it runs on a database no other test file shares.
let ownDatabase: FreshTestDatabase;
let app: INestApplication;

beforeAll(async () => {
  ownDatabase = await freshTestDatabase();
});

afterAll(async () => {
  await ownDatabase.drop();
});

beforeEach(async () => {
  ({ app } = await startTestApplication({
    database: { url: ownDatabase.url },
    providers: [PostgresThreadRepository, ConversationsEarlierRecords],
  }));
});

afterEach(async () => {
  await app.close();
});

const FIRST_USER = { userId: randomUUID(), name: "Dee Ray" };
const AT = new Date("2026-11-01T10:00:00.000Z");
const DECISION = {
  kind: "question",
  roleKey: "planner",
  question: "Which columns?",
  context: "The export is wide.",
  options: ["All", "Visible"],
  recommendation: { option: 1, reason: "Fewer to read." },
  askedAt: AT,
  answeredAt: AT,
} as const;

function database(): Database {
  return app.get<Database>(DATABASE);
}

function repository(): PostgresThreadRepository {
  return app.get(PostgresThreadRepository);
}

/**
 * A Thread whose records are kept as the migration left them before users existed: what a user
 * did names nobody (null), what an Agent did names no user at all; and one Ben Ito wrote since.
 */
async function earlierRecords() {
  const thread = aThread({ id: randomUUID(), home: { kind: "chat", roleKey: "planner" } });
  await repository().add(thread);
  const asked = { roleKey: "cto", threadId: randomUUID() };
  // Kept before the form: the answer lines hold the answer as one, with no `formAnswer`.
  const bodies: SavedMessage[] = [
    { kind: "user", text: "Hello.", delivery: "delivered", writtenBy: null },
    { kind: "changes-allowed", allowed: true, by: null },
    {
      kind: "decision-answer",
      decisionId: randomUUID(),
      answer: { kind: "option", option: 0 },
      atUsersRequest: { ...asked, user: null },
    },
    { kind: "decision-answer", decisionId: randomUUID(), answer: { kind: "option", option: 1 } },
    { kind: "person", roleKey: "planner", text: "Hi." },
    { kind: "user", text: "Since then.", delivery: "delivered", writtenBy: BEN_ITO },
  ];
  await database()
    .insert(threadMessages)
    .values(bodies.map((body) => ({ id: randomUUID(), threadId: thread.id, body, at: AT })));
  const answers = {
    ownAnswer: { kind: "option", option: 0, user: null },
    atUsersRequest: { kind: "option", option: 1, atUsersRequest: { ...asked, user: null } },
    consultants: { kind: "option", option: 0, answeredBy: "cto" },
    theOffices: { kind: "free-answer", text: "Retry.", byTheOffice: true },
    bens: { kind: "option", option: 1, user: BEN_ITO },
  } as const;
  const decisionIds = Object.fromEntries(
    Object.keys(answers).map((name) => [name, randomUUID()]),
  ) as Record<keyof typeof answers, string>;
  await database()
    .insert(decisions)
    .values(
      Object.entries(answers).map(([name, answer]) => ({
        ...DECISION,
        id: decisionIds[name as keyof typeof answers],
        threadId: thread.id,
        taskId: randomUUID(),
        answer,
      })),
    );
  const proposal = (status: "open" | "applied" | "declined") => ({
    id: randomUUID(),
    threadId: thread.id,
    draftedBy: "office-manager",
    draftedAt: AT,
    change: { kind: "office-instructions", from: "", to: "Plain words." } as const,
    status,
    statusAt: status === "open" ? null : AT,
  });
  const applied = proposal("applied");
  const declined = proposal("declined");
  const open = proposal("open");
  await database().insert(proposals).values([applied, declined, open]);
  await database()
    .insert(officeInstructionsVersions)
    .values([
      { version: 1, text: "Plain words.", savedAt: AT },
      { version: 2, text: "Plainer words.", savedAt: AT, savedBy: BEN_ITO },
    ]);
  return { thread, decisionIds, proposalIds: [applied.id, declined.id, open.id] };
}

async function recordsOf({ thread, decisionIds, proposalIds }: EarlierRecordsMade) {
  return {
    messages: (await repository().messages(thread.id)).map(({ id: _id, ...message }) => message),
    decisions: await Promise.all(
      Object.values(decisionIds).map(async (id) => (await repository().decision(id))?.answer),
    ),
    proposals: await Promise.all(
      proposalIds.map(async (id) => (await repository().proposal(id))?.status),
    ),
    officeInstructions: await database()
      .select({
        version: officeInstructionsVersions.version,
        by: officeInstructionsVersions.savedBy,
      })
      .from(officeInstructionsVersions)
      .orderBy(asc(officeInstructionsVersions.version)),
  };
}

type EarlierRecordsMade = Awaited<ReturnType<typeof earlierRecords>>;

/** A kept option, as the form's answer to its one question. */
function picked(option: number) {
  return { kind: "submitted", answers: [{ kind: "option", option }] };
}

describe("Conversations' claim on its records from before users existed", () => {
  it("names the first user in what a user did, once, leaving what an Agent did and Ben's own as they are", async () => {
    const made = await earlierRecords();

    await app.get(EarlierRecords).claimFor(FIRST_USER);

    const claimed = await recordsOf(made);
    expect(
      claimed.messages.map((message) => {
        switch (message.kind) {
          case "user":
            return message.writtenBy;
          case "changes-allowed":
            return message.by;
          case "decision-answer":
            return message.atUsersRequest?.user;
          default:
            return message.kind;
        }
      }),
    ).toEqual([FIRST_USER, FIRST_USER, FIRST_USER, undefined, "person", BEN_ITO]);
    expect(claimed.decisions).toEqual([
      { ...picked(0), user: FIRST_USER, answeredAt: AT },
      {
        ...picked(1),
        atUsersRequest: { roleKey: "cto", threadId: expect.any(String), user: FIRST_USER },
        answeredAt: AT,
      },
      { ...picked(0), answeredBy: "cto", answeredAt: AT },
      {
        kind: "submitted",
        answers: [{ kind: "words", text: "Retry." }],
        byTheOffice: true,
        answeredAt: AT,
      },
      { ...picked(1), user: BEN_ITO, answeredAt: AT },
    ]);
    expect(claimed.proposals).toEqual([
      { kind: "applied", at: AT, by: FIRST_USER },
      { kind: "declined", at: AT, by: FIRST_USER },
      { kind: "open" },
    ]);
    expect(claimed.officeInstructions).toEqual([
      { version: 1, by: FIRST_USER },
      { version: 2, by: BEN_ITO },
    ]);

    await app.get(EarlierRecords).claimFor({ userId: randomUUID(), name: "Eve Later" });
    expect(await recordsOf(made)).toEqual(claimed);
  });
});
