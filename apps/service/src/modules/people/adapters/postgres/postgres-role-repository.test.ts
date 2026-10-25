import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { aRole, aRoleCard } from "../../domain/role.fixtures.js";
import type { Role } from "../../domain/role.js";
import { changeRoleCard } from "../../domain/role-changes.js";
import { RoleNotFound } from "../../domain/role-not-found.js";
import { PostgresRoleRepository } from "./postgres-role-repository.js";

let app: INestApplication;
let repository: PostgresRoleRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresRoleRepository],
  }));
  repository = app.get(PostgresRoleRepository);
});

afterAll(async () => {
  await app.close();
});

/** A Role of this test's own: every test file shares the database. */
function aRoleOfItsOwn(fields: Partial<Role> = {}): Role {
  return aRole({ key: `role-${randomUUID()}`, ...fields });
}

describe("PostgresRoleRepository", () => {
  it("keeps a Role as it was hired, with its card as version 1", async () => {
    const role = aRoleOfItsOwn();

    await expect(repository.add(role)).resolves.toBe(true);

    await expect(repository.find(role.key)).resolves.toEqual(role);
    await expect(repository.versions(role.key)).resolves.toEqual([
      { version: 1, card: role.card, changes: [], savedAt: role.cardSavedAt },
    ]);
  });

  it("keeps the Role as it was when someone already fills it", async () => {
    const role = aRoleOfItsOwn();
    await repository.add(role);

    await expect(repository.add({ ...role, card: aRoleCard({ name: "Adele" }) })).resolves.toBe(
      false,
    );

    await expect(repository.find(role.key)).resolves.toEqual(role);
  });

  it("lists Roles in the order they were hired", async () => {
    const earlier = aRoleOfItsOwn();
    const laterAt = new Date(earlier.hiredAt.getTime() + 1000);
    const later = aRoleOfItsOwn({ hiredAt: laterAt, cardSavedAt: laterAt });
    await repository.add(later);
    await repository.add(earlier);

    const keys = (await repository.list()).map((role) => role.key);

    expect(keys.filter((key) => key === earlier.key || key === later.key)).toEqual([
      earlier.key,
      later.key,
    ]);
  });

  it("saves a change as the card's next version, with what changed", async () => {
    const role = aRoleOfItsOwn();
    await repository.add(role);
    const savedAt = new Date("2026-10-25T11:00:00.000Z");

    const { role: changed, event } = await repository.update(role.key, (stored) =>
      changeRoleCard(stored, aRoleCard({ taskLimit: 2 }), savedAt),
    );

    expect(changed).toEqual({
      ...role,
      card: aRoleCard({ taskLimit: 2 }),
      cardVersion: 2,
      cardSavedAt: savedAt,
    });
    expect(event?.changes).toEqual([{ field: "taskLimit", from: 3, to: 2 }]);
    await expect(repository.find(role.key)).resolves.toEqual(changed);
    await expect(repository.version(role.key, 1)).resolves.toMatchObject({ card: role.card });
    await expect(repository.versions(role.key)).resolves.toEqual([
      { version: 2, card: changed.card, changes: event?.changes, savedAt },
      { version: 1, card: role.card, changes: [], savedAt: role.cardSavedAt },
    ]);
  });

  it("saves nothing when nothing changes", async () => {
    const role = aRoleOfItsOwn();
    await repository.add(role);

    const update = await repository.update(role.key, () => undefined);

    expect(update).toEqual({ role, event: undefined });
    await expect(repository.versions(role.key)).resolves.toHaveLength(1);
  });

  it("keeps both of two changes made at once", async () => {
    const role = aRoleOfItsOwn();
    await repository.add(role);
    const savedAt = new Date();

    await Promise.all([
      repository.update(role.key, (stored) =>
        changeRoleCard(stored, { ...stored.card, taskLimit: 1 }, savedAt),
      ),
      repository.update(role.key, (stored) =>
        changeRoleCard(stored, { ...stored.card, effort: "max" }, savedAt),
      ),
    ]);

    const stored = await repository.find(role.key);
    expect(stored?.cardVersion).toBe(3);
    expect(stored?.card).toMatchObject({ taskLimit: 1, effort: "max" });
  });

  it("refuses to change a Role nobody fills", async () => {
    await expect(repository.update(`role-${randomUUID()}`, () => undefined)).rejects.toThrow(
      RoleNotFound,
    );
  });

  it("finds no version a Role doesn't have", async () => {
    const role = aRoleOfItsOwn();
    await repository.add(role);

    await expect(repository.version(role.key, 2)).resolves.toBeUndefined();
  });
});
