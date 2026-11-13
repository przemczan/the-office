import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { passkeyOf } from "../../domain/passkey.js";
import { addUser } from "../../index.fixtures.js";
import { PasskeyRepository } from "../../ports/passkey-repository.js";
import { startUsersApplication, type UsersApplication } from "../../users-application.fixtures.js";
import { users } from "./users.schema.js";

const NOW = new Date("2026-11-13T09:00:00.000Z");

let office: UsersApplication;
let repository: PasskeyRepository;

beforeEach(async () => {
  office = await startUsersApplication();
  repository = office.app.get(PasskeyRepository, { strict: false });
});

afterEach(async () => {
  await office.app.close();
});

function passkeyFor(userId: string) {
  return passkeyOf(
    randomUUID(),
    userId,
    "Laptop",
    "localhost",
    {
      credentialId: randomBytes(16).toString("base64url"),
      publicKey: new Uint8Array(randomBytes(77)),
      counter: 2 ** 32 - 1,
      transports: ["internal", "hybrid"],
      deviceType: "multi-device",
      backedUp: true,
    },
    NOW,
  );
}

describe("PostgresPasskeyRepository", () => {
  it("keeps every part of a passkey as it was given", async () => {
    const user = await addUser(office.app);
    const passkey = passkeyFor(user.id);

    await repository.add(passkey);

    expect(await repository.findByCredentialId(passkey.credentialId)).toEqual(passkey);
    expect(await repository.find(user.id, passkey.id)).toEqual(passkey);
    expect(await repository.find(randomUUID(), passkey.id)).toBeUndefined();
  });

  it("refuses a credential id kept already", async () => {
    const user = await addUser(office.app);
    const passkey = passkeyFor(user.id);
    await repository.add(passkey);

    const refused = await repository
      .add({ ...passkey, id: randomUUID() })
      .catch((error: unknown) => error);

    // Postgres's unique violation.
    expect(refused).toMatchObject({ cause: { code: "23505" } });
  });

  it("goes with its user's row", async () => {
    const user = await addUser(office.app);
    const passkey = passkeyFor(user.id);
    await repository.add(passkey);

    const database = office.app.get<symbol, Database>(DATABASE);
    await database.delete(users).where(eq(users.id, user.id));

    expect(await repository.findByCredentialId(passkey.credentialId)).toBeUndefined();
  });
});
