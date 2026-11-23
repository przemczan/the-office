import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { roleCardSchema } from "@the-office/contracts";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../platform/database/database.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineModels,
  EngineReferenceLock,
  FIRST_CLAUDE_CODE_ENGINE,
  type Engine,
  type EngineModel,
} from "../../engine/index.js";
import { EngineSettingsForTests } from "../../engine/index.fixtures.js";
import { PostgresRoleRepository } from "../adapters/postgres/postgres-role-repository.js";
import { roleCardVersions, roles } from "../adapters/postgres/roles.schema.js";
import { CARETAKER } from "../domain/known-roles.js";
import type { Effort } from "../domain/role-card.js";
import { aRoleCard } from "../domain/role.fixtures.js";
import { RoleCardChanged } from "../domain/role-events.js";
import { EngineSettingsMoveOver } from "./engine-settings-move-over.js";

const gemini: Engine = {
  id: "gemini",
  name: "Gemini",
  kind: "gemini-cli",
  defaultModel: "auto",
  defaultEffort: null,
  apiKey: null,
};

let app: INestApplication;
let database: Database;
let repository: PostgresRoleRepository;
let moveOver: EngineSettingsMoveOver;
let published: RoleCardChanged[];

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true, providers: [PostgresRoleRepository] }));
  database = app.get(DATABASE);
  repository = app.get(PostgresRoleRepository);
  const events = new EventBus();
  events.subscribe(RoleCardChanged, (event) => {
    published.push(event);
  });
  // The engines listed, of the test's own: every test file shares Settings › Engines.
  const engineModels = new EngineModels(
    new EngineSettingsForTests({ engines: [FIRST_CLAUDE_CODE_ENGINE, gemini] }),
  );
  moveOver = new EngineSettingsMoveOver(
    repository,
    engineModels,
    new EngineReferenceLock(),
    events,
  );
});

afterAll(async () => {
  await app.close();
});

/**
 * A Role of the test's own whose card the release before saved, as version 2: a Role override and
 * an effort, no engine settings.
 */
async function aRoleSavedBefore(
  roleOverride: EngineModel | null,
  effort: Effort,
  letGo = false,
): Promise<string> {
  const key = `role-${randomUUID()}`;
  const { engineSettings: _engineSettings, ...card } = aRoleCard();
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
      card: { ...card, roleOverride, effort },
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

describe("EngineSettingsMoveOver", () => {
  it("gives each Role saved before one new version, its effort on every type taking it, naming no user", async () => {
    const key = await aRoleSavedBefore(null, "max");
    published = [];

    await moveOver.moveOver();

    const role = await repository.find(key);
    expect(role).toMatchObject({
      cardVersion: 3,
      cardSavedBy: null,
      cardProposedBy: undefined,
      card: { engineSettings: { "claude-code": { model: null, effort: "max" } } },
    });
    const [moved] = await repository.versions(key);
    expect(moved?.changes).toEqual([
      { field: "engineSettingsMovedOver", from: null, to: null },
      {
        field: "engineSettings",
        from: {},
        to: { "claude-code": { model: null, effort: "max" } },
      },
    ]);
    expect(published.filter((event) => event.role.key === key)).toHaveLength(1);
  });

  it("makes a Role override on a listed engine the person's model on its type", async () => {
    const onClaudeCode = { engineId: "claude-code", model: "claude-opus-5-5" };
    const onGemini = { engineId: "gemini", model: "pro" };
    const toClaudeCode = await aRoleSavedBefore(onClaudeCode, "low");
    const toGemini = await aRoleSavedBefore(onGemini, "high");

    await moveOver.moveOver();

    expect((await repository.find(toClaudeCode))?.card.engineSettings).toEqual({
      "claude-code": { model: "claude-opus-5-5", effort: "low" },
      codex: { model: null, effort: "low" },
    });
    expect((await repository.find(toGemini))?.card.engineSettings).toEqual({
      "claude-code": { model: null, effort: "high" },
      codex: { model: null, effort: "high" },
      "gemini-cli": { model: "pro", effort: null },
    });
    const [moved] = await repository.versions(toGemini);
    expect(moved?.changes[0]).toEqual({
      field: "engineSettingsMovedOver",
      from: onGemini,
      to: "gemini-cli",
    });
  });

  it("drops a Role override on an engine no longer listed, naming it on the Changes", async () => {
    const onRemoved = { engineId: "removed", model: "qwen3" };
    const key = await aRoleSavedBefore(onRemoved, "medium");

    await moveOver.moveOver();

    expect((await repository.find(key))?.card.engineSettings).toEqual({
      "claude-code": { model: null, effort: "medium" },
      codex: { model: null, effort: "medium" },
    });
    const [moved] = await repository.versions(key);
    expect(moved?.changes).toContainEqual({
      field: "engineSettingsMovedOver",
      from: onRemoved,
      to: null,
    });
  });

  it("keeps the earlier fields stored for a rollback, and reads none of them", async () => {
    const onClaudeCode = { engineId: "claude-code", model: "claude-haiku-5-5" };
    const key = await aRoleSavedBefore(onClaudeCode, "low");

    await moveOver.moveOver();

    expect(await storedCard(key, 3)).toMatchObject({ roleOverride: onClaudeCode, effort: "low" });
    expect((await repository.find(key))?.card).not.toHaveProperty("effort");
    expect((await repository.find(key))?.card).not.toHaveProperty("roleOverride");
  });

  it("moves each Role once: a second start adds no version", async () => {
    const key = await aRoleSavedBefore(null, "high");

    await moveOver.moveOver();
    published = [];
    await moveOver.moveOver();

    expect((await repository.find(key))?.cardVersion).toBe(3);
    expect(await repository.rolesToMoveOver()).not.toContain(key);
    expect(published.filter((event) => event.role.key === key)).toEqual([]);
  });

  it("moves people let go and the Caretaker too", async () => {
    const letGo = await aRoleSavedBefore(null, "high", true);

    await moveOver.moveOver();

    expect(await repository.find(letGo)).toMatchObject({
      cardVersion: 3,
      letGoAt: expect.any(Date),
      card: { engineSettings: { "claude-code": { model: null, effort: "high" } } },
    });
    // Seeded by migration 0087 on every database, and moved by whichever start came first.
    const caretaker = await repository.find(CARETAKER);
    expect(await repository.rolesToMoveOver()).not.toContain(CARETAKER);
    const stored = await storedCard(CARETAKER, caretaker?.cardVersion ?? 0);
    expect(stored).toHaveProperty("engineSettings");
    expect(stored).toHaveProperty("roleOverride");
    expect(stored).toHaveProperty("effort");
  });
});

describe("migration 0202", () => {
  it("gives every hire Proposal's card no engine settings and takes the earlier fields out of open change Proposals", async () => {
    const migration = await readFile(
      new URL("../../../../drizzle/0202_engine_settings.sql", import.meta.url),
      "utf8",
    );
    const threadId = randomUUID();
    const before = { roleOverride: null, effort: "high", taskLimit: 2 };
    // A whole card as the release before drafted it, stored as the Proposals store it.
    const { engineSettings: _engineSettings, ...earlier } = aRoleCard();
    const cardBefore = { ...earlier, roleOverride: null, effort: "high" };
    const officeSetup = (hiredKeys?: readonly string[]) => ({
      kind: "office-setup",
      hires: [
        { kind: "hire-from-preset", roleKey: "developer", name: "Ada" },
        { kind: "hire", card: cardBefore, skills: ["git"] },
      ],
      duties: [],
      ...(hiredKeys && { hiredKeys }),
    });

    const after = await rolledBackMigration(database, async (transaction) => {
      await transaction.execute(
        sql`INSERT INTO "threads" ("id", "home_kind", "home_id", "role_key", "state", "tokens", "started_at")
          VALUES (${threadId}, 'office', 'office', 'cto', 'idle', '{}'::jsonb, now())`,
      );
      const aProposal = async (change: object, status = "open") => {
        const id = randomUUID();
        await transaction.execute(
          sql`INSERT INTO "proposals" ("id", "thread_id", "drafted_by", "drafted_at", "change", "status")
            VALUES (${id}, ${threadId}, 'cto', now(), ${JSON.stringify(change)}::jsonb, ${status})`,
        );
        return id;
      };
      const hire = await aProposal({ kind: "hire", card: before, skills: [] });
      const appliedHire = await aProposal(
        { kind: "hire", card: cardBefore, skills: [], roleKey: "release-manager" },
        "applied",
      );
      const declinedHire = await aProposal(
        { kind: "hire", card: cardBefore, skills: [] },
        "declined",
      );
      const openSetUp = await aProposal(officeSetup());
      const appliedSetUp = await aProposal(
        officeSetup(["developer", "release-manager"]),
        "applied",
      );
      const presetsOnly = await aProposal({ ...officeSetup(), hires: [] });
      const change = await aProposal({
        kind: "change",
        roleKey: "developer",
        from: before,
        to: { ...before, effort: "low" },
      });
      const applied = await aProposal(
        { kind: "change", roleKey: "developer", from: before, to: before },
        "applied",
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      const rows = await transaction.execute<{ id: string; change: object }>(
        sql`SELECT "id", "change" FROM "proposals" WHERE "thread_id" = ${threadId}`,
      );
      const changeOf = (id: string) => rows.rows.find((row) => row.id === id)?.change;
      return {
        hire: changeOf(hire),
        appliedHire: changeOf(appliedHire),
        declinedHire: changeOf(declinedHire),
        openSetUp: changeOf(openSetUp),
        appliedSetUp: changeOf(appliedSetUp),
        presetsOnly: changeOf(presetsOnly),
        change: changeOf(change),
        applied: changeOf(applied),
      };
    });

    const cardAfter = { ...cardBefore, engineSettings: {} };
    expect(after.hire).toEqual({
      kind: "hire",
      card: { ...before, engineSettings: {} },
      skills: [],
    });
    expect(after.appliedHire).toEqual({
      kind: "hire",
      card: cardAfter,
      skills: [],
      roleKey: "release-manager",
    });
    expect(after.declinedHire).toEqual({ kind: "hire", card: cardAfter, skills: [] });
    for (const [setUp, hiredKeys] of [
      [after.openSetUp, undefined],
      [after.appliedSetUp, ["developer", "release-manager"]],
    ] as const) {
      expect(setUp).toEqual({
        ...officeSetup(hiredKeys),
        hires: [
          { kind: "hire-from-preset", roleKey: "developer", name: "Ada" },
          { kind: "hire", card: cardAfter, skills: ["git"] },
        ],
      });
    }
    expect(after.presetsOnly).toEqual({ ...officeSetup(), hires: [] });
    // Each card is whole as this release's web reads it, and keeps what the release before reads.
    expect(() => roleCardSchema.parse({ ...cardAfter, skills: [] })).not.toThrow();
    expect(after.change).toEqual({
      kind: "change",
      roleKey: "developer",
      from: { taskLimit: 2 },
      to: { taskLimit: 2 },
    });
    expect(after.applied).toMatchObject({ from: before, to: before });
  });
});
