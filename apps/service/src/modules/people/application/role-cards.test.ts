import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { EngineModule } from "../../engine/index.js";
import { SkillsModule } from "../../skills/index.js";
import { PostgresRoleRepository } from "../adapters/postgres/postgres-role-repository.js";
import { aRole, aRoleCard } from "../domain/role.fixtures.js";
import { RoleCardVersionNotFound } from "../domain/role-card-version-not-found.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { RoleRepository } from "../ports/role-repository.js";
import { RoleCards } from "./role-cards.js";
import { RoleService } from "./role-service.js";

let app: INestApplication;
let roleCards: RoleCards;
let roles: RoleService;
let repository: RoleRepository;
let officeData: string;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-role-cards-"));
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      SkillsModule,
      EngineModule,
    ],
    providers: [
      { provide: RoleRepository, useClass: PostgresRoleRepository },
      RoleService,
      RoleCards,
    ],
  }));
  roleCards = app.get(RoleCards);
  roles = app.get(RoleService);
  repository = app.get(RoleRepository);
});

afterAll(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

describe("RoleCards", () => {
  it("gives a Role card change only to sessions started after it", async () => {
    const role = aRole({ key: `role-${randomUUID()}` });
    await repository.add(role);

    const before = await roleCards.forNewSession(role.key);
    await roles.changeCard(role.key, aRoleCard({ model: "claude-sonnet-5-5", taskLimit: 2 }), []);
    const after = await roleCards.forNewSession(role.key);

    expect(before).toEqual({ roleKey: role.key, cardVersion: 1, card: role.card });
    expect(after).toEqual({
      roleKey: role.key,
      cardVersion: 2,
      card: aRoleCard({ model: "claude-sonnet-5-5", taskLimit: 2 }),
    });
    await expect(roleCards.forResumedSession(role.key, before.cardVersion)).resolves.toEqual(
      before,
    );
  });

  it("refuses a session of a Role nobody fills", async () => {
    await expect(roleCards.forNewSession(`role-${randomUUID()}`)).rejects.toThrow(RoleNotFound);
  });

  it("finds the current card, or nothing for a Role nobody fills", async () => {
    const role = aRole({ key: `role-${randomUUID()}` });
    await repository.add(role);

    await expect(roleCards.find(role.key)).resolves.toEqual({
      roleKey: role.key,
      cardVersion: 1,
      card: role.card,
    });
    await expect(roleCards.find(`role-${randomUUID()}`)).resolves.toBeUndefined();
  });

  it("gives no session to a person let go, new or resumed, until they are hired back", async () => {
    const role = aRole({ key: `role-${randomUUID()}` });
    await repository.add(role);
    const session = await roleCards.forNewSession(role.key);

    await roles.letGo(role.key);

    await expect(roleCards.find(role.key)).resolves.toBeUndefined();
    await expect(roleCards.forNewSession(role.key)).rejects.toThrow(RoleNotFound);
    await expect(roleCards.forResumedSession(role.key, 1)).rejects.toThrow(RoleNotFound);

    await roles.hireBack(role.key);

    await expect(roleCards.forResumedSession(role.key, 1)).resolves.toEqual(session);
  });

  it("refuses to resume with a card version the Role doesn't have", async () => {
    const role = aRole({ key: `role-${randomUUID()}` });
    await repository.add(role);

    await expect(roleCards.forResumedSession(role.key, 2)).rejects.toThrow(
      new RoleCardVersionNotFound(role.key, 2),
    );
  });
});
