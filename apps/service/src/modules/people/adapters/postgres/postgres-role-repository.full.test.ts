import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { CARETAKER_FIXED_PARTS } from "../../domain/caretaker.js";
import { CARETAKER } from "../../domain/known-roles.js";
import { roleCardProblems } from "../../domain/role-card.js";
import { aRole, aRoleCard, CARD_CONTEXT } from "../../domain/role.fixtures.js";
import type { Role } from "../../domain/role.js";
import { changeAvatar, changeRoleCard } from "../../domain/role-changes.js";
import { RoleNotFound } from "../../domain/role-not-found.js";
import { PostgresRoleRepository } from "./postgres-role-repository.js";
import { roleCardVersions } from "./roles.schema.js";

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

    // Its card version is the seed's until a start moves its engine settings over.
    expect(caretaker).toMatchObject({
      key: CARETAKER,
      letGoAt: undefined,
      card: {
        title: "Caretaker",
        capabilities: CARETAKER_FIXED_PARTS.capabilities,
        permissionProfile: { ...CARETAKER_FIXED_PARTS.permissionProfile, mcpTools: {} },
        hardSwitches: CARETAKER_FIXED_PARTS.hardSwitches,
        taskLimit: "none",
      },
    });
    expect(caretaker && roleCardProblems(CARETAKER, caretaker.card, CARD_CONTEXT)).toEqual([]);
  });

  it("gives the seeded Caretaker the presets' words on correcting and Dropping records", async () => {
    const caretaker = await repository.find(CARETAKER);

    expect(caretaker?.card.instructions).toContain(
      "Decide alone: reading and diagnosing anything but secrets, correcting a Task or an Idea for your own mistake or what the user clarified (its fields, Dropping it before it starts, Archiving or Restoring it).",
    );
    expect(caretaker?.card.instructions).toContain(
      "and Dropping a Task or an Idea somebody else created. A started Task is the user's to Drop.",
    );
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
        changeRoleCard(stored, { ...stored.card, taskLimit: 1 }, CARD_CONTEXT, savedAt, null),
      ),
      repository.update(role.key, (stored) =>
        changeRoleCard(
          stored,
          { ...stored.card, engineSettings: { "claude-code": { model: null, effort: "max" } } },
          CARD_CONTEXT,
          savedAt,
          null,
        ),
      ),
    ]);

    const stored = await repository.find(role.key);
    expect(stored?.cardVersion).toBe(3);
    expect(stored?.card).toMatchObject({
      taskLimit: 1,
      engineSettings: { "claude-code": { model: null, effort: "max" } },
    });
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
      changeRoleCard(stored, { ...stored.card, title: "Tester" }, CARD_CONTEXT, new Date(), null),
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

  it("keeps a new hire's earlier fields for a rollback, carried to each version, unread", async () => {
    const role = aRoleOfItsOwn();
    await repository.add(role);
    await repository.update(role.key, (stored) =>
      changeRoleCard(stored, { ...stored.card, title: "Tester" }, CARD_CONTEXT, new Date(), null),
    );

    const kept = await app
      .get<Database>(DATABASE)
      .select({ card: roleCardVersions.card })
      .from(roleCardVersions)
      .where(eq(roleCardVersions.roleKey, role.key))
      .orderBy(asc(roleCardVersions.version));

    expect(kept.map(({ card }) => [card.roleOverride, card.effort])).toEqual([
      [null, "high"],
      [null, "high"],
    ]);
    expect(await repository.find(role.key)).not.toHaveProperty("card.effort");
    expect(await repository.find(role.key)).not.toHaveProperty("card.roleOverride");
  });
});
