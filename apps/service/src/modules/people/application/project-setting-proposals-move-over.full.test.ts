import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../platform/database/database.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { PostgresRoleRepository } from "../adapters/postgres/postgres-role-repository.js";
import { roleCardVersions } from "../adapters/postgres/roles.schema.js";
import { PROPOSAL, type Authority } from "../domain/authority.js";
import { ALLOWED, ASK_ME, NEVER } from "../domain/hard-switches.js";
import { aRole, aRoleCard, CARD_CONTEXT } from "../domain/role.fixtures.js";
import { changeRoleCard } from "../domain/role-changes.js";
import { RoleCardChanged } from "../domain/role-events.js";
import type { RoleRepository } from "../ports/role-repository.js";
import { ProjectSettingProposalsMoveOver } from "./project-setting-proposals-move-over.js";

let app: INestApplication;
let database: Database;
let repository: PostgresRoleRepository;
let moveOver: ProjectSettingProposalsMoveOver;
let published: RoleCardChanged[];
/** The Roles this file moves: every test file shares the database, and moves only its own. */
const own = new Set<string>();

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true, providers: [PostgresRoleRepository] }));
  database = app.get(DATABASE);
  repository = app.get(PostgresRoleRepository);
  const events = new EventBus();
  events.subscribe(RoleCardChanged, (event) => {
    published.push(event);
  });
  const ownRoles: RoleRepository = Object.create(repository, {
    rolesWithRetiredProposalRows: {
      value: async () =>
        (await repository.rolesWithRetiredProposalRows()).filter((key) => own.has(key)),
    },
  });
  moveOver = new ProjectSettingProposalsMoveOver(ownRoles, events);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  published = [];
});

/** The retired tools' rows as an earlier release stored them, each at `kind`. */
function retiredRows(kind: "proposal" | "never"): Record<string, { kind: string }> {
  return {
    proposeProjectCommands: { kind },
    proposeTestTargets: { kind },
    proposeActions: { kind },
  };
}

/**
 * A Role of the test's own, from scratch, whose stored card keeps `retired` beside `authority`, as
 * the release before saved it, with a change of that release's history naming one of its rows.
 */
async function aRoleSavedBefore(
  authority: Authority,
  retired: Record<string, { kind: string }>,
): Promise<string> {
  const key = `role-${randomUUID()}`;
  own.add(key);
  await repository.add(aRole({ key, card: aRoleCard({ authority }) }));
  await database
    .update(roleCardVersions)
    .set({
      card: sql`jsonb_set(${roleCardVersions.card}, '{authority}', coalesce(${roleCardVersions.card} -> 'authority', '{}'::jsonb) || ${JSON.stringify(retired)}::jsonb)`,
      changes: [
        { field: "authority.proposeActions", from: null, to: { kind: "proposal" } },
      ] as never,
    })
    .where(eq(roleCardVersions.roleKey, key));
  return key;
}

async function storedAuthority(key: string): Promise<Record<string, unknown>> {
  const [row] = await database
    .select({ card: roleCardVersions.card })
    .from(roleCardVersions)
    .where(eq(roleCardVersions.roleKey, key))
    .orderBy(sql`${roleCardVersions.version} desc`)
    .limit(1);
  return (row?.card.authority ?? {}) as Record<string, unknown>;
}

describe("a card saved with the retired Proposal tools' rows", () => {
  it("reads without them, in its Authority and its history", async () => {
    const key = await aRoleSavedBefore({ projectUpkeep: ASK_ME }, retiredRows("proposal"));

    const role = await repository.find(key);
    const [first] = await repository.versions(key);

    expect(role?.card.authority).toEqual({ projectUpkeep: ASK_ME });
    expect(first?.card.authority).toEqual({ projectUpkeep: ASK_ME });
    expect(first?.changes).toEqual([]);
  });
});

describe("ProjectSettingProposalsMoveOver", () => {
  it("sets Change Project settings to Proposal on a Role that kept a retired row at Proposal and left it Never, in one version naming no user", async () => {
    const key = await aRoleSavedBefore({ changeProjectSettings: NEVER }, retiredRows("proposal"));

    await moveOver.moveOver();

    const after = await repository.find(key);
    expect(after).toMatchObject({ cardVersion: 2, cardSavedBy: null, cardProposedBy: undefined });
    expect(after?.card.authority).toEqual({ changeProjectSettings: PROPOSAL });
    const [moved] = await repository.versions(key);
    expect(moved?.changes[0]).toEqual({
      field: "projectSettingProposalsMovedOver",
      from: null,
      to: null,
    });
    expect(moved?.changes.slice(1).map(({ field }) => field)).toEqual([
      "authority.changeProjectSettings",
    ]);
    // The version kept holds none of the retired rows.
    expect(await storedAuthority(key)).not.toHaveProperty("proposeActions");
    expect(published.filter((event) => event.role.key === key)).toHaveLength(1);
  });

  it("moves a Role from scratch that kept one retired row too, and changes nothing the second time", async () => {
    const key = await aRoleSavedBefore(
      { changeProjectSettings: NEVER },
      { proposeTestTargets: { kind: "proposal" } },
    );
    await moveOver.moveOver();
    published = [];

    await moveOver.moveOver();

    expect((await repository.find(key))?.cardVersion).toBe(2);
    expect(await repository.rolesWithRetiredProposalRows()).not.toContain(key);
    expect(published.filter((event) => event.role.key === key)).toEqual([]);
  });

  it("leaves a card that leaves Change Project settings freer than Never as it is", async () => {
    const asked = await aRoleSavedBefore(
      { changeProjectSettings: ASK_ME },
      retiredRows("proposal"),
    );
    const allowed = await aRoleSavedBefore(
      { changeProjectSettings: ALLOWED },
      retiredRows("proposal"),
    );

    await moveOver.moveOver();

    for (const key of [asked, allowed]) {
      expect((await repository.find(key))?.cardVersion).toBe(1);
    }
    expect((await repository.find(asked))?.card.authority.changeProjectSettings).toEqual(ASK_ME);
    expect((await repository.find(allowed))?.card.authority.changeProjectSettings).toEqual(ALLOWED);
  });

  it("leaves a Role whose retired rows were Never, which had no reach to lose", async () => {
    const key = await aRoleSavedBefore({ changeProjectSettings: NEVER }, retiredRows("never"));

    await moveOver.moveOver();

    expect((await repository.find(key))?.cardVersion).toBe(1);
    expect((await repository.find(key))?.card.authority.changeProjectSettings).toEqual(NEVER);
  });

  it("leaves a Change Project settings the user sets Never afterwards at the next start", async () => {
    const key = await aRoleSavedBefore({ changeProjectSettings: NEVER }, retiredRows("proposal"));
    await moveOver.moveOver();
    await repository.update(key, (role) =>
      changeRoleCard(
        role,
        { ...role.card, authority: { ...role.card.authority, changeProjectSettings: NEVER } },
        CARD_CONTEXT,
        new Date(),
        null,
      ),
    );

    await moveOver.moveOver();

    expect((await repository.find(key))?.card.authority.changeProjectSettings).toEqual(NEVER);
    expect((await repository.find(key))?.cardVersion).toBe(3);
  });
});
