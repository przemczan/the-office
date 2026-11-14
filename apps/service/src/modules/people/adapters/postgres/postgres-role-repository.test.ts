import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { aRole, aRoleCard, CARD_CONTEXT } from "../../domain/role.fixtures.js";
import type { Role } from "../../domain/role.js";
import { changeRoleCard } from "../../domain/role-changes.js";
import { ANN_LEE, BEN_ITO } from "../../domain/user.fixtures.js";
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
  it("keeps a Role as it was hired, with its card as version 1 saved by the user who hired", async () => {
    const role = aRoleOfItsOwn({ cardSavedBy: ANN_LEE });

    await expect(repository.add(role)).resolves.toBe(true);

    await expect(repository.find(role.key)).resolves.toEqual(role);
    await expect(repository.versions(role.key)).resolves.toEqual([
      { version: 1, card: role.card, changes: [], savedAt: role.cardSavedAt, savedBy: ANN_LEE },
    ]);
  });

  it("saves a change as the card's next version, with what changed and who saved it", async () => {
    const role = aRoleOfItsOwn({ cardSavedBy: ANN_LEE });
    await repository.add(role);
    const savedAt = new Date("2026-10-25T11:00:00.000Z");

    const { role: changed, event } = await repository.update(role.key, (stored) =>
      changeRoleCard(stored, aRoleCard({ taskLimit: 2 }), CARD_CONTEXT, savedAt, BEN_ITO),
    );

    expect(changed).toEqual({
      ...role,
      card: aRoleCard({ taskLimit: 2 }),
      cardVersion: 2,
      cardSavedAt: savedAt,
      cardSavedBy: BEN_ITO,
    });
    expect(event?.changes).toEqual([{ field: "taskLimit", from: 3, to: 2 }]);
    await expect(repository.find(role.key)).resolves.toEqual(changed);
    await expect(repository.version(role.key, 1)).resolves.toMatchObject({ card: role.card });
    await expect(repository.versions(role.key)).resolves.toEqual([
      { version: 2, card: changed.card, changes: event?.changes, savedAt, savedBy: BEN_ITO },
      { version: 1, card: role.card, changes: [], savedAt: role.cardSavedAt, savedBy: ANN_LEE },
    ]);
  });
});
