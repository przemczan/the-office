import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../platform/database/database.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineReferenceLock } from "../../engine/index.js";
import { PostgresRoleRepository } from "../adapters/postgres/postgres-role-repository.js";
import { roleCardVersions, roles } from "../adapters/postgres/roles.schema.js";
import { hardSwitchesOf, PROPOSAL, type Authority } from "../domain/authority.js";
import { DUTIES, type DutyKey } from "../domain/duties.js";
import { ALLOWED, ASK_ME, consult, NEVER, type HardSwitches } from "../domain/hard-switches.js";
import { CARETAKER } from "../domain/known-roles.js";
import {
  aCardSavedBeforeAuthority,
  aRole,
  aRoleCard,
  CARD_CONTEXT,
} from "../domain/role.fixtures.js";
import { changeRoleCard } from "../domain/role-changes.js";
import { RoleCardChanged } from "../domain/role-events.js";
import { DutyRepositoryForTests } from "../ports/duty-repository.fixtures.js";
import type { RoleRepository } from "../ports/role-repository.js";
import { AuthorityMoveOver } from "./authority-move-over.js";
import { Duties } from "./duties.js";
import { DutyChangeChecks } from "./duty-change-checks.js";

let app: INestApplication;
let database: Database;
let repository: PostgresRoleRepository;
let dutyRepository: DutyRepositoryForTests;
let moveOver: AuthorityMoveOver;
let published: RoleCardChanged[];
/** The Roles this file moves: every test file shares the database, and moves only its own. */
const own = new Set<string>([CARETAKER]);

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true, providers: [PostgresRoleRepository] }));
  database = app.get(DATABASE);
  repository = app.get(PostgresRoleRepository);
  const events = new EventBus();
  events.subscribe(RoleCardChanged, (event) => {
    published.push(event);
  });
  const ownRoles: RoleRepository = Object.create(repository, {
    rolesToMoveAuthorityOver: {
      value: async () =>
        (await repository.rolesToMoveAuthorityOver()).filter((key) => own.has(key)),
    },
    rolesToGiveDutiesJobs: {
      value: async () => (await repository.rolesToGiveDutiesJobs()).filter((key) => own.has(key)),
    },
  });
  // The duties of the test's own: every test file shares the stored ones.
  dutyRepository = new DutyRepositoryForTests();
  const duties = new Duties(
    dutyRepository,
    repository,
    new DutyChangeChecks(),
    events,
    new EngineReferenceLock(),
  );
  moveOver = new AuthorityMoveOver(ownRoles, duties, events);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  published = [];
});

/**
 * A Role of the test's own whose card the release before Authority saved, as version 2: its Hard
 * switches, no Authority, with `changeProjectSettings` left out when the switches lack it.
 */
async function aRoleSavedBefore(
  switches: Partial<HardSwitches>,
  { letGo = false }: { letGo?: boolean } = {},
): Promise<string> {
  const key = `role-${randomUUID()}`;
  own.add(key);
  const card = { ...aCardSavedBeforeAuthority(), hardSwitches: switches };
  const hiredAt = new Date("2026-10-01T09:00:00.000Z");
  await database.insert(roles).values({
    key,
    cardVersion: 2,
    hiredAt,
    letGoAt: letGo ? hiredAt : null,
    avatar: null,
  });
  for (const version of [1, 2]) {
    await database.insert(roleCardVersions).values({
      roleKey: key,
      version,
      card: { ...card, hardSwitches: switches as HardSwitches, roleOverride: null, effort: "high" },
      changes: [],
      savedAt: hiredAt,
      proposedBy: null,
      savedBy: null,
    });
  }
  return key;
}

async function storedCard(key: string, version: number) {
  const [row] = await database
    .select({ card: roleCardVersions.card })
    .from(roleCardVersions)
    .where(and(eq(roleCardVersions.roleKey, key), eq(roleCardVersions.version, version)));
  return row?.card;
}

const SWITCHES: HardSwitches = {
  runInstalls: consult("devops"),
  publishOutsideThePipeline: ASK_ME,
  changeRoles: ALLOWED,
  changeProjectSettings: NEVER,
};

describe("AuthorityMoveOver", () => {
  it("gives each Role saved before one new version naming no user, its Hard switches kept but Change Roles", async () => {
    const key = await aRoleSavedBefore(SWITCHES);
    const before = await repository.find(key);

    await moveOver.moveOver();

    const after = await repository.find(key);
    expect(after).toMatchObject({ cardVersion: 3, cardSavedBy: null, cardProposedBy: undefined });
    // Change Roles Allowed reads as Ask me by the trust anchor's cap, before and after.
    expect(before && hardSwitchesOf(key, before.card.authority).changeRoles).toEqual(ASK_ME);
    expect(after && hardSwitchesOf(key, after.card.authority)).toEqual(
      before && hardSwitchesOf(key, before.card.authority),
    );
    const [moved] = await repository.versions(key);
    expect(moved?.changes).toEqual([
      { field: "authorityMovedOver", from: null, to: null },
      // A record's creator keeps their cover; the rows held by no duty are Never.
      {
        field: "authority.taskRecords",
        from: null,
        to: { kind: "own-and-others", own: ALLOWED, others: ASK_ME },
      },
      { field: "authority.initiativeRecords", from: null, to: NEVER },
      {
        field: "authority.ideas",
        from: null,
        to: { kind: "own-and-others", own: ALLOWED, others: ASK_ME },
      },
      { field: "authority.projectSettings", from: null, to: NEVER },
      { field: "authority.projectUpkeep", from: null, to: NEVER },
      { field: "authority.pipelinesAndStageTemplates", from: null, to: NEVER },
      { field: "authority.promptTemplates", from: null, to: NEVER },
      { field: "authority.officeSettings", from: null, to: NEVER },
    ]);
    // The rest of the card as it was, and the Hard switches kept in step for the release before.
    expect({ ...after?.card, authority: undefined }).toEqual({
      ...before?.card,
      authority: undefined,
    });
    expect((await storedCard(key, 3))?.hardSwitches).toEqual({
      ...SWITCHES,
      changeRoles: ASK_ME,
    });
    expect(published.filter((event) => event.role.key === key)).toHaveLength(1);
  });

  it("makes Change Roles Never a Proposal for whoever holds Default person to talk to", async () => {
    const key = await aRoleSavedBefore({ ...SWITCHES, changeRoles: NEVER });
    await dutyRepository.assign("default-person-to-talk-to", key);

    try {
      await moveOver.moveOver();
    } finally {
      await dutyRepository.assign("default-person-to-talk-to", null);
    }

    expect((await repository.find(key))?.card.authority).toMatchObject({
      changeRoles: PROPOSAL,
      officeSettings: PROPOSAL,
    });
  });

  it("moves a card missing Change Project settings as Ask me, and people let go and the Caretaker too", async () => {
    const { changeProjectSettings: _missing, ...withoutIt } = SWITCHES;
    const key = await aRoleSavedBefore(withoutIt, { letGo: true });

    await moveOver.moveOver();

    const after = await repository.find(key);
    expect(after).toMatchObject({ cardVersion: 3, letGoAt: expect.any(Date) });
    expect(after && hardSwitchesOf(key, after.card.authority).changeProjectSettings).toEqual(
      ASK_ME,
    );
    // Seeded by migration 0087 on every database, and moved by whichever start came first.
    expect(await repository.rolesToMoveAuthorityOver()).not.toContain(CARETAKER);
    const caretaker = await repository.find(CARETAKER);
    const stored = await storedCard(CARETAKER, caretaker?.cardVersion ?? 0);
    expect(stored?.authority).toEqual({});
    expect(stored?.hardSwitches).toEqual(hardSwitchesOf(CARETAKER, {}));
  });

  it("moves each Role once: a second start adds no version", async () => {
    const key = await aRoleSavedBefore(SWITCHES);

    await moveOver.moveOver();
    published = [];
    await moveOver.moveOver();

    expect((await repository.find(key))?.cardVersion).toBe(3);
    expect(await repository.rolesToMoveAuthorityOver()).not.toContain(key);
    expect(published.filter((event) => event.role.key === key)).toEqual([]);
  });
});

/**
 * Hires a Role of the test's own, from scratch, with the card's Authority as set, as hired before
 * the second move-over: not given its duties' jobs yet.
 */
async function aHolder(authority: Authority, duties: readonly DutyKey[]): Promise<string> {
  const key = `holder-${randomUUID()}`;
  own.add(key);
  await repository.add(aRole({ key, card: aRoleCard({ authority }) }));
  await database.update(roles).set({ dutyJobsGiven: false }).where(eq(roles.key, key));
  await assignOnly(key, duties);
  return key;
}

/** Assigns `duties` to `key` and every other duty to nobody, so no other file's Role is touched. */
async function assignOnly(key: string, duties: readonly DutyKey[]): Promise<void> {
  await dutyRepository.assignAll(
    DUTIES.map(({ key: duty }) => ({
      duty: duty as DutyKey,
      roleKey: duties.includes(duty as DutyKey) ? key : null,
    })),
  );
}

describe("AuthorityMoveOver, giving the duties' jobs", () => {
  it("gives a holder whose card leaves a row of its job Never one new version naming no user, with only those rows", async () => {
    const key = await aHolder({ projectUpkeep: NEVER, projectSettings: NEVER }, [
      "onboards-projects",
    ]);

    await moveOver.giveDutiesJobs();

    const after = await repository.find(key);
    expect(after).toMatchObject({ cardVersion: 2, cardSavedBy: null, cardProposedBy: undefined });
    expect(after?.card.authority).toMatchObject({
      projectUpkeep: ALLOWED,
      projectSettings: PROPOSAL,
      // A capped row at Proposal, never Allowed.
      publishingSettings: PROPOSAL,
      proposeProjectCommands: PROPOSAL,
      proposeTestTargets: PROPOSAL,
      proposeActions: PROPOSAL,
    });
    // Ask me stays Ask me: only a Never row takes the job's setting.
    expect(after?.card.authority.pipelinesAndStageTemplates).toBeUndefined();
    const [given] = await repository.versions(key);
    expect(given?.changes[0]).toEqual({ field: "authorityFromDutiesHeld", from: null, to: null });
    expect(given?.changes.slice(1).every(({ field }) => field.startsWith("authority."))).toBe(true);
    expect(published.filter((event) => event.role.key === key)).toHaveLength(1);
  });

  it("changes nothing the second time", async () => {
    const key = await aHolder({ projectUpkeep: NEVER }, ["onboards-projects"]);
    await moveOver.giveDutiesJobs();
    published = [];

    await moveOver.giveDutiesJobs();

    expect((await repository.find(key))?.cardVersion).toBe(2);
    expect(published.filter((event) => event.role.key === key)).toEqual([]);
  });

  it("leaves a row the user set Never after it at the next start", async () => {
    const key = await aHolder({ projectUpkeep: NEVER }, ["onboards-projects"]);
    await moveOver.giveDutiesJobs();
    await repository.update(key, (role) =>
      changeRoleCard(
        role,
        { ...role.card, authority: { ...role.card.authority, projectUpkeep: NEVER } },
        CARD_CONTEXT,
        new Date(),
        null,
      ),
    );

    await moveOver.giveDutiesJobs();

    expect((await repository.find(key))?.card.authority.projectUpkeep).toEqual(NEVER);
    expect((await repository.find(key))?.cardVersion).toBe(3);
  });

  it("gives nothing for a duty assigned after it, nor to a Role hired after it", async () => {
    const holdsNothing = await aHolder({ projectUpkeep: NEVER }, []);
    await moveOver.giveDutiesJobs();
    const hiredAfter = `holder-${randomUUID()}`;
    own.add(hiredAfter);
    await repository.add(
      aRole({ key: hiredAfter, card: aRoleCard({ authority: { projectUpkeep: NEVER } }) }),
    );
    await assignOnly(holdsNothing, ["onboards-projects"]);

    await moveOver.giveDutiesJobs();
    await assignOnly(hiredAfter, ["onboards-projects"]);
    await moveOver.giveDutiesJobs();

    expect((await repository.find(holdsNothing))?.cardVersion).toBe(1);
    expect((await repository.find(hiredAfter))?.cardVersion).toBe(1);
  });

  it("leaves a Role that holds no duty, and one whose card gives its whole job, as they are", async () => {
    const holdsNothing = await aHolder({ projectUpkeep: NEVER }, []);
    const gives = await aHolder(
      {
        publishingSettings: PROPOSAL,
        proposeProjectCommands: PROPOSAL,
        proposeTestTargets: PROPOSAL,
        proposeActions: PROPOSAL,
      },
      ["onboards-projects"],
    );

    await moveOver.giveDutiesJobs();

    expect((await repository.find(holdsNothing))?.cardVersion).toBe(1);
    expect((await repository.find(gives))?.cardVersion).toBe(1);
  });

  it("gives the holder of Default person to talk to Change Roles as Proposal, never Allowed", async () => {
    const key = await aHolder({}, ["default-person-to-talk-to"]);

    await moveOver.giveDutiesJobs();

    const authority = (await repository.find(key))?.card.authority;
    expect(authority?.changeRoles).toEqual(PROPOSAL);
    expect(authority).toMatchObject({ postLinkCard: ALLOWED, showOfficeStatus: ALLOWED });
  });
});
