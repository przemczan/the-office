import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { EngineModule } from "../../engine/index.js";
import { McpServersModule } from "../../mcp-servers/index.js";
import { SkillsModule } from "../../skills/index.js";
import { DutyHolderChanged } from "../domain/duty-events.js";
import { CARETAKER } from "../domain/known-roles.js";
import { hiredKeyOf, type SetUpHire } from "../domain/office-setup.js";
import type { Role } from "../domain/role.js";
import { aRole, aRoleCard } from "../domain/role.fixtures.js";
import { RoleHired } from "../domain/role-events.js";
import { RoleRefused } from "../domain/role-refused.js";
import { ANN_LEE } from "../domain/user.fixtures.js";
import { DutyRepository } from "../ports/duty-repository.js";
import { DutyRepositoryForTests } from "../ports/duty-repository.fixtures.js";
import { OfficeSetupRepository } from "../ports/office-setup-repository.js";
import { OfficeSetupRepositoryForTests } from "../ports/office-setup-repository.fixtures.js";
import { RoleRepository } from "../ports/role-repository.js";
import { Duties } from "./duties.js";
import { DutyChangeChecks } from "./duty-change-checks.js";
import { OfficeSetup } from "./office-setup.js";
import { RoleOverrideChecks } from "./role-override-checks.js";
import { RoleService } from "./role-service.js";

/**
 * The Roles in memory: a set-up hires the presets, whose keys are fixed, so none is kept on the
 * shared database (testing.md). Only what hiring reads and writes is kept.
 */
class RolesInMemory extends RoleRepository {
  readonly roles = new Map<string, Role>();

  add(role: Role): Promise<boolean> {
    if (this.roles.has(role.key)) return Promise.resolve(false);
    this.roles.set(role.key, role);
    return Promise.resolve(true);
  }

  find(key: string): Promise<Role | undefined> {
    return Promise.resolve(this.roles.get(key));
  }

  list(): Promise<readonly Role[]> {
    return Promise.resolve([...this.roles.values()]);
  }

  update(): never {
    throw new Error("A set-up changes no card.");
  }

  changeStanding(): never {
    throw new Error("A set-up lets nobody go.");
  }

  changeAvatar(): never {
    throw new Error("A set-up changes no Avatar.");
  }

  version(): never {
    throw new Error("A set-up reads no version.");
  }

  versions(): never {
    throw new Error("A set-up reads no version.");
  }
}

let app: INestApplication;
let officeData: string;
let setUp: OfficeSetup;
let roles: RolesInMemory;
let duties: DutyRepositoryForTests;
let published: DomainEvent[];

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-setup-"));
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      SkillsModule,
      McpServersModule,
      EngineModule,
    ],
    providers: [
      { provide: RoleRepository, useClass: RolesInMemory },
      { provide: DutyRepository, useClass: DutyRepositoryForTests },
      {
        provide: OfficeSetupRepository,
        inject: [RoleRepository, DutyRepository],
        useFactory: (roleRepository: RoleRepository, dutyRepository: DutyRepository) =>
          new OfficeSetupRepositoryForTests(roleRepository, dutyRepository),
      },
      RoleService,
      RoleOverrideChecks,
      Duties,
      DutyChangeChecks,
      OfficeSetup,
    ],
  }));
  setUp = app.get(OfficeSetup);
  app.get(EventBus).subscribeToEveryEvent((event) => {
    published.push(event);
    return Promise.resolve();
  });
});

beforeEach(() => {
  roles = app.get<RolesInMemory>(RoleRepository);
  roles.roles.clear();
  roles.roles.set(CARETAKER, aRole({ key: CARETAKER, card: aRoleCard({ title: "Caretaker" }) }));
  duties = app.get<DutyRepositoryForTests>(DutyRepository);
  published = [];
});

afterAll(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

const jan: SetUpHire = { kind: "hire-from-preset", roleKey: "planner", name: "Jan" };

/** A Role from scratch under a title of its own, so its key is the test's own. */
function fromScratch(name: string): SetUpHire & { kind: "hire" } {
  return {
    kind: "hire",
    card: aRoleCard({ name, title: `Builder ${randomUUID().slice(0, 8)}` }),
    skills: [],
  };
}

async function refusal(made: Promise<unknown>): Promise<readonly string[]> {
  const error: unknown = await made.catch((caught: unknown) => caught);
  if (error instanceof RoleRefused) return error.reasons;
  throw new Error("The set-up was not refused.");
}

describe("OfficeSetup", () => {
  it("hires everyone and gives a duty to a Role the same set-up hires, as proposed by the Caretaker", async () => {
    const max = fromScratch("Max");
    const maxKey = hiredKeyOf(max);

    const hired = await setUp.setUp(
      [jan, max],
      [{ duty: "implements", from: "developer", to: maxKey }],
      ANN_LEE,
      CARETAKER,
    );

    expect(hired.map((role) => role.key)).toEqual(["planner", maxKey]);
    expect(roles.roles.get("planner")).toMatchObject({
      card: { name: "Jan", title: "Planner" },
      cardProposedBy: CARETAKER,
      cardSavedBy: ANN_LEE,
    });
    expect(roles.roles.get(maxKey)).toMatchObject({ cardProposedBy: CARETAKER });
    await expect(duties.assignments()).resolves.toEqual({ implements: maxKey });
    expect(published.filter((event) => event instanceof RoleHired)).toHaveLength(2);
    expect(published.filter((event) => event instanceof DutyHolderChanged)).toEqual([
      expect.objectContaining({ duty: "implements", from: "developer", to: maxKey }),
    ]);
  });

  it("refuses with every reason, saving nothing", async () => {
    const ola: SetUpHire = { kind: "hire-from-preset", roleKey: "planner", name: "Ola" };
    const savesBefore = duties.saves;

    const reasons = await refusal(
      setUp.setUp(
        [jan, ola],
        [
          { duty: "plans", from: "planner", to: CARETAKER },
          { duty: "reviews", from: "reviewer", to: "nobody-hired" },
          { duty: "implements", from: "someone-else", to: "planner" },
        ],
        ANN_LEE,
        CARETAKER,
      ),
    );

    expect(reasons).toEqual(
      expect.arrayContaining([
        'Jan · Planner and Ola · Planner would fill the same Role "planner"; hire one person into it.',
        "The Caretaker is built in and holds no duty, so not Plans.",
        'Reviews goes to a hired Role, and nobody is hired as "nobody-hired".',
        "Implements was changed meanwhile, so this change no longer applies.",
      ]),
    );
    expect([...roles.roles.keys()]).toEqual([CARETAKER]);
    expect(duties.saves).toBe(savesBefore);
    expect(published).toEqual([]);
  });

  it("hires nobody when one hire is refused", async () => {
    const reasons = await refusal(
      setUp.setUp([jan, { ...jan, roleKey: "developer", name: " " }], [], ANN_LEE, CARETAKER),
    );

    expect(reasons.every((reason) => reason.startsWith(" · Developer: "))).toBe(true);
    expect([...roles.roles.keys()]).toEqual([CARETAKER]);
    expect(published).toEqual([]);
  });

  it("judges a set-up as it would be applied, saving nothing", async () => {
    await expect(setUp.problems([jan], [])).resolves.toEqual([]);
    await expect(setUp.problems([], [])).resolves.toEqual([
      "Nothing to set up: give the people to hire, the duties to assign, or both.",
    ]);
    expect([...roles.roles.keys()]).toEqual([CARETAKER]);
  });
});
