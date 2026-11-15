import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../test/test-database.js";
import { EarlierRecords } from "../../../platform/earlier-records/earlier-records.js";
import type { SignedInUser } from "../../../platform/http/signed-in-requests.js";
import {
  newSetupToken,
  send,
  startUsersApplication,
  type UsersApplication,
} from "../users-application.fixtures.js";

/** What the test claim was given, and whether it fails, shared by every app a test starts. */
const claimed: SignedInUser[] = [];
let failsNext = false;

@Injectable()
class ClaimForTests implements OnModuleInit {
  constructor(private readonly earlierRecords: EarlierRecords) {}

  onModuleInit(): void {
    this.earlierRecords.add("tests", (firstUser) => {
      if (failsNext) {
        failsNext = false;
        return Promise.reject(new Error("The database went away."));
      }
      claimed.push(firstUser);
      return Promise.resolve();
    });
  }
}

@Module({ providers: [ClaimForTests] })
class ClaimForTestsModule {}

const FIRST_USER = { name: "Ann Lee", email: "ann@example.com", password: "analytical engine" };

describe("earlier records", () => {
  let database: FreshTestDatabase;
  let office: UsersApplication | undefined;

  const start = async (): Promise<UsersApplication> => {
    await office?.app.close();
    office = await startUsersApplication({
      databaseUrl: database.url,
      imports: [ClaimForTestsModule],
    });
    return office;
  };

  beforeEach(async () => {
    database = await freshTestDatabase();
    claimed.length = 0;
    failsNext = false;
  });

  afterEach(async () => {
    await office?.app.close();
    office = undefined;
    await database.drop();
  });

  it("are claimed for the first user once made, and never again at a start", async () => {
    const started = await start();
    expect(claimed).toEqual([]);

    const made = await send(started.port, {
      method: "POST",
      path: "/api/sign-in/first-user",
      body: { ...FIRST_USER, setupToken: await newSetupToken(started) },
    });
    expect(made.status).toBe(201);
    expect(claimed).toEqual([{ userId: expect.any(String), name: "Ann Lee" }]);

    await start();
    expect(claimed).toHaveLength(1);
  });

  it("are claimed at the next start when a claim failed", async () => {
    const started = await start();
    failsNext = true;
    const made = await send(started.port, {
      method: "POST",
      path: "/api/sign-in/first-user",
      body: { ...FIRST_USER, setupToken: await newSetupToken(started) },
    });
    expect(made.status).toBe(201);
    expect(claimed).toEqual([]);

    await start();
    expect(claimed).toEqual([{ userId: expect.any(String), name: "Ann Lee" }]);
    await start();
    expect(claimed).toHaveLength(1);
  });
});
