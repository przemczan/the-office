import { createHash } from "node:crypto";
import { Logger } from "@nestjs/common";
import { firstRunSetupSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { setUp as officeLoggerForTests } from "../../../../platform/telemetry/office-logger.fixtures.js";
import { FirstRunSetup } from "../../application/first-run-setup.js";
import { addUser, signedInCookie } from "../../index.fixtures.js";
import {
  newSetupToken,
  send,
  setCookieOf,
  startUsersApplication,
  type UsersApplication,
} from "../../users-application.fixtures.js";
import { firstRunSetup } from "../postgres/first-run-setup.schema.js";

const FIRST_USER = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "analytical engine notes",
};

async function createFirstUser(started: UsersApplication, setupToken: string): Promise<string> {
  const made = await send(started.port, {
    method: "POST",
    path: "/api/sign-in/first-user",
    body: { ...FIRST_USER, setupToken },
  });
  expect(made.status).toBe(201);
  return setCookieOf(made).cookie;
}

async function basicsAt(started: UsersApplication, cookie: string): Promise<string> {
  const answer = await send(started.port, { path: "/api/first-run-setup", headers: { cookie } });
  expect(answer.status).toBe(200);
  return firstRunSetupSchema.parse(answer.body).basics;
}

describe("First-run setup", () => {
  let database: FreshTestDatabase;
  let office: UsersApplication | undefined;

  const start = async (skipSetupBasics = false): Promise<UsersApplication> => {
    await office?.app.close();
    office = await startUsersApplication({
      databaseUrl: database.url,
      identityProviders: { imports: [], identityProviders: [], skipSetupBasics },
    });
    return office;
  };

  beforeEach(async () => {
    database = await freshTestDatabase();
  });

  afterEach(async () => {
    await office?.app.close();
    office = undefined;
    await database.drop();
  });

  it("makes a token once at start, keeps it while it waits, and needs none after the first user", async () => {
    const started = await start();
    const setup = started.app.get(FirstRunSetup);

    const first = await setup.tokenAtStart();
    expect(first).toEqual({ kind: "made", token: expect.stringMatching(/^(\w{4}-){5}\w{4}$/) });
    expect(await setup.tokenAtStart()).toEqual({ kind: "waiting" });

    const restarted = await start();
    expect(await restarted.app.get(FirstRunSetup).tokenAtStart()).toEqual({ kind: "waiting" });
    if (first.kind !== "made") throw new Error("No token was made.");
    await createFirstUser(restarted, first.token);

    expect(await restarted.app.get(FirstRunSetup).tokenAtStart()).toEqual({ kind: "not-needed" });
  });

  it("ends the earlier token at a new one", async () => {
    const started = await start();
    const atStart = await started.app.get(FirstRunSetup).tokenAtStart();
    if (atStart.kind !== "made") throw new Error("No token was made.");
    const replacing = await newSetupToken(started);

    const refused = await send(started.port, {
      method: "POST",
      path: "/api/sign-in/first-user",
      body: { ...FIRST_USER, setupToken: atStart.token },
    });
    expect(refused.status).toBe(403);
    await createFirstUser(started, replacing);
  });

  it("keeps only the token's hash, in no log record or event", async () => {
    const { logger, records } = officeLoggerForTests();
    Logger.overrideLogger(logger);
    const events: DomainEvent[] = [];
    try {
      const started = await start();
      started.app.get(EventBus).subscribeToEveryEvent((event) => {
        events.push(event);
      });
      const token = await newSetupToken(started);
      const typed = token.replaceAll("-", "");

      const rows = await started.app.get<symbol, Database>(DATABASE).select().from(firstRunSetup);
      expect(rows).toEqual([
        expect.objectContaining({
          setupTokenHash: createHash("sha256").update(typed).digest("hex"),
        }),
      ]);
      expect(JSON.stringify(rows)).not.toContain(typed);
      await createFirstUser(started, token);

      const logged = JSON.stringify(records.getFinishedLogRecords().map(({ body }) => body));
      expect(logged).not.toContain(typed);
      expect(events.map((event) => event.constructor.name)).toContain("SetupTokenMade");
      expect(JSON.stringify(events)).not.toContain(typed);
    } finally {
      Logger.overrideLogger(false);
    }
  });

  it("opens the basics after the first user, until they are closed for good", async () => {
    const started = await start();
    expect(
      (await send(started.port, { path: "/api/first-run-setup" })).status,
      "without a signed-in device",
    ).toBe(401);
    expect(
      (await send(started.port, { method: "POST", path: "/api/first-run-setup/close" })).status,
    ).toBe(401);
    const cookie = await createFirstUser(started, await newSetupToken(started));
    expect(await basicsAt(started, cookie)).toBe("open");

    const closed = await send(started.port, {
      method: "POST",
      path: "/api/first-run-setup/close",
      headers: { cookie },
    });
    expect(closed.status).toBe(204);
    expect(await basicsAt(started, cookie)).toBe("closed");

    const restarted = await start();
    expect(await basicsAt(restarted, cookie)).toBe("closed");
  });

  it("with OFFICE_SKIP_SETUP_BASICS still needs the token and the first user, and closes the basics", async () => {
    const started = await start(true);
    const refused = await send(started.port, {
      method: "POST",
      path: "/api/sign-in/first-user",
      body: FIRST_USER,
    });
    expect(refused.status).toBe(403);

    const cookie = await createFirstUser(started, await newSetupToken(started));
    expect(await basicsAt(started, cookie)).toBe("closed");
  });

  it("never opens the basics in an Office that had users before", async () => {
    const started = await start();
    const user = await addUser(started.app);

    expect(await basicsAt(started, await signedInCookie(started.url, user))).toBe("closed");
  });
});
