import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { CARETAKER_FIXED_PARTS } from "../../domain/caretaker.js";
import { CARETAKER } from "../../domain/known-roles.js";
import { roleCardProblems } from "../../domain/role-card.js";
import { aRole, aRoleCard, OFFERED_MODELS } from "../../domain/role.fixtures.js";
import type { Role } from "../../domain/role.js";
import { changeAvatar, changeRoleCard } from "../../domain/role-changes.js";
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
  it("holds the built-in Caretaker on a fresh database, their card's fixed parts as fixed", async () => {
    const caretaker = await repository.find(CARETAKER);

    expect(caretaker).toMatchObject({
      key: CARETAKER,
      cardVersion: 1,
      letGoAt: undefined,
      card: {
        title: "Caretaker",
        capabilities: CARETAKER_FIXED_PARTS.capabilities,
        permissionProfile: { ...CARETAKER_FIXED_PARTS.permissionProfile, mcpTools: {} },
        hardSwitches: CARETAKER_FIXED_PARTS.hardSwitches,
        taskLimit: "none",
      },
    });
    expect(caretaker && roleCardProblems(CARETAKER, caretaker.card, OFFERED_MODELS)).toEqual([]);
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
        changeRoleCard(stored, { ...stored.card, taskLimit: 1 }, OFFERED_MODELS, savedAt),
      ),
      repository.update(role.key, (stored) =>
        changeRoleCard(stored, { ...stored.card, effort: "max" }, OFFERED_MODELS, savedAt),
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

  it("keeps an Avatar with no new card version, and keeps it through a card change", async () => {
    const role = aRoleOfItsOwn();
    await repository.add(role);
    const avatar = { id: randomUUID(), mediaType: "image/webp" } as const;

    const { event } = await repository.changeAvatar(role.key, (stored) =>
      changeAvatar(stored, avatar, new Date()),
    );
    await repository.update(role.key, (stored) =>
      changeRoleCard(stored, { ...stored.card, title: "Tester" }, OFFERED_MODELS, new Date()),
    );

    expect(event?.role.cardVersion).toBe(1);
    expect((await repository.find(role.key))?.avatar).toEqual(avatar);
    expect(await repository.versions(role.key)).toHaveLength(2);
  });

  it("saves nothing when the Avatar stays", async () => {
    const role = aRoleOfItsOwn();
    await repository.add(role);

    const { event } = await repository.changeAvatar(role.key, () => undefined);

    expect(event).toBeUndefined();
  });

  it("refuses to change the Avatar of a Role never hired", async () => {
    await expect(repository.changeAvatar("nobody", () => undefined)).rejects.toThrow(RoleNotFound);
  });

  it("finds no version a Role doesn't have", async () => {
    const role = aRoleOfItsOwn();
    await repository.add(role);

    await expect(repository.version(role.key, 2)).resolves.toBeUndefined();
  });
});
