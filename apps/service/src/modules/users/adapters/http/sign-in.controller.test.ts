import { createHash } from "node:crypto";
import { accountSchema, signInPageSchema, userRefusalSchema } from "@the-office/contracts";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { addUser } from "../../index.fixtures.js";
import {
  send,
  setCookieOf,
  startUsersApplication,
  type UsersApplication,
} from "../../users-application.fixtures.js";
import { signedInDevices, users } from "../postgres/users.schema.js";

const FIRST_USER = {
  name: "Ada Lovelace",
  email: "Ada@Example.com",
  password: "analytical engine notes",
};

describe("the first user", () => {
  let database: FreshTestDatabase;
  let office: UsersApplication;

  beforeAll(async () => {
    database = await freshTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    office = await startUsersApplication({ databaseUrl: database.url });
  });

  afterEach(async () => {
    await office.app.close();
  });

  it("is asked for while no user exists, signed in once made, and refused after", async () => {
    const before = await send(office.port, { path: "/api/sign-in" });
    expect(signInPageSchema.parse(before.body)).toEqual({
      firstRun: true,
      ways: [{ kind: "password" }, { kind: "passkey" }],
      unavailable: [],
    });

    const refused = await send(office.port, {
      method: "POST",
      path: "/api/sign-in/first-user",
      body: { name: " ", email: "ada", password: "short" },
    });
    expect(refused.status).toBe(422);
    expect(userRefusalSchema.parse(refused.body).reasons).toEqual([
      "Give a name.",
      "Give an email such as ada@example.com.",
      "A password has at least 12 characters.",
    ]);

    const made = await send(office.port, {
      method: "POST",
      path: "/api/sign-in/first-user",
      body: FIRST_USER,
    });
    expect(made.status).toBe(201);
    expect(made.body).toEqual({ outcome: "signed-in" });
    const { cookie } = setCookieOf(made);
    const account = await send(office.port, { path: "/api/account", headers: { cookie } });
    expect(accountSchema.parse(account.body)).toMatchObject({
      name: "Ada Lovelace",
      email: "Ada@Example.com",
    });

    const after = await send(office.port, { path: "/api/sign-in" });
    expect(signInPageSchema.parse(after.body).firstRun).toBe(false);
    const again = await send(office.port, {
      method: "POST",
      path: "/api/sign-in/first-user",
      body: { ...FIRST_USER, email: "grace@example.com" },
    });
    expect(again.status).toBe(409);
  });

  it("makes one first user of two asked for at once", async () => {
    const own = await freshTestDatabase();
    const racing = await startUsersApplication({ databaseUrl: own.url });
    try {
      const answers = await Promise.all(
        ["ada@example.com", "grace@example.com"].map((email) =>
          send(racing.port, {
            method: "POST",
            path: "/api/sign-in/first-user",
            body: { ...FIRST_USER, email },
          }),
        ),
      );

      expect(answers.map(({ status }) => status).toSorted()).toEqual([201, 409]);
      const rows = await racing.app.get<symbol, Database>(DATABASE).select().from(users);
      expect(rows).toHaveLength(1);
    } finally {
      await racing.app.close();
      await own.drop();
    }
  });
});

describe("signing in with a password", () => {
  let office: UsersApplication;

  beforeEach(async () => {
    office = await startUsersApplication();
  });

  afterEach(async () => {
    await office.app.close();
  });

  it("sets an HttpOnly, SameSite=Lax cookie, Secure only through the public address over HTTPS", async () => {
    const user = await addUser(office.app);
    const signIn = (host: string | undefined, headers: Record<string, string> = {}) =>
      send(office.port, {
        method: "POST",
        path: "/api/sign-in/password",
        ...(host !== undefined && { host }),
        headers: { "user-agent": "Firefox", ...headers },
        // Compared without case.
        body: { email: user.email.toUpperCase(), password: user.password },
      });

    const atLocalhost = await signIn(undefined);
    const atPublicHttps = await signIn("office.example.com", {
      origin: "https://office.example.com",
      "x-forwarded-proto": "https",
    });
    const atPublicHttp = await signIn("office.example.com");

    expect(atLocalhost.status).toBe(200);
    expect(atLocalhost.body).toEqual({ outcome: "signed-in" });
    const cookies = [atLocalhost, atPublicHttps, atPublicHttp].map((answer) => setCookieOf(answer));
    for (const { attributes } of cookies) {
      expect(attributes).toEqual(expect.arrayContaining(["HttpOnly", "SameSite=Lax", "Path=/"]));
    }
    expect(cookies.map(({ attributes }) => attributes.includes("Secure"))).toEqual([
      false,
      true,
      false,
    ]);

    const database = office.app.get<symbol, Database>(DATABASE);
    const [row] = await database.select().from(users).where(eq(users.id, user.id));
    expect(row?.passwordHash).toMatch(/^scrypt\$\d+\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(row?.passwordHash).not.toContain(user.password);
    const devices = await database
      .select()
      .from(signedInDevices)
      .where(eq(signedInDevices.userId, user.id));
    const tokens = cookies.map(({ cookie }) => cookie.split("=")[1] ?? "");
    expect(devices.map(({ tokenHash }) => tokenHash).toSorted()).toEqual(
      tokens.map((token) => createHash("sha256").update(token).digest("hex")).toSorted(),
    );
    expect(JSON.stringify(devices)).not.toMatch(new RegExp(tokens.join("|")));
    expect(devices.map(({ addressKind, userAgent }) => ({ addressKind, userAgent }))).toEqual(
      expect.arrayContaining([
        { addressKind: "localhost", userAgent: "Firefox" },
        { addressKind: "public", userAgent: "Firefox" },
      ]),
    );
  });

  it.each([
    ["localhost", (port: number) => `localhost:${port}`],
    ["a loopback IP", (port: number) => `127.0.0.1:${port}`],
    ["the public address", () => "office.example.com"],
  ])("offers a password at %s", async (_, host) => {
    const page = await send(office.port, { path: "/api/sign-in", host: host(office.port) });

    expect(signInPageSchema.parse(page.body).ways).toContainEqual({ kind: "password" });
  });
});
