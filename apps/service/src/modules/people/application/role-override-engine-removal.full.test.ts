import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { EngineReferenceMoves, FIRST_CLAUDE_CODE_ENGINE } from "../../engine/index.js";
import {
  EngineSettingsForTests,
  EngineSettingsRepository,
  EngineSettingsService,
} from "../../engine/index.fixtures.js";
import { aRoleCard } from "../domain/role.fixtures.js";
import type { RoleCard } from "../domain/role-card.js";
import { RoleRefused } from "../domain/role-refused.js";
import { ANN_LEE } from "../domain/user.fixtures.js";
import { PeopleModule } from "../people.module.js";
import { RoleOverrideChecks } from "./role-override-checks.js";
import { RoleService } from "./role-service.js";

// Engine settings of the test's own, so removing an engine leaves the shared database's alone;
// the Roles are in the shared database, so each test hires one of its own title.
const suffix = randomUUID().slice(0, 8);
const RACING = { ...FIRST_CLAUDE_CODE_ENGINE, id: `racing-${suffix}`, name: `Racing ${suffix}` };
const ON_RACING = { engineId: RACING.id, model: "claude-haiku-5-5" };

let officeData: string;
let app: INestApplication;
let roles: RoleService;

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-role-removal-"));
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      PeopleModule,
    ],
    overrides: [
      {
        provide: EngineSettingsRepository,
        useValue: new EngineSettingsForTests({ engines: [FIRST_CLAUDE_CODE_ENGINE, RACING] }),
      },
    ],
  }));
  roles = app.get(RoleService);
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

/** A card of a Role of the test's own. */
function aCardOfItsOwn(fields: Partial<RoleCard> = {}): RoleCard {
  return aRoleCard({ title: `Racer ${randomUUID().slice(0, 8)}`, ...fields });
}

function removeRacing(): Promise<unknown> {
  return app.get(EngineSettingsService).remove(RACING.id, FIRST_CLAUDE_CODE_ENGINE.id);
}

/** A promise held until `release`, and one kept when something starts waiting on it. */
function aHold(): { reached: Promise<void>; wait: () => Promise<void>; release: () => void } {
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => (reach = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  return { reached, wait: () => (reach(), released), release };
}

describe("a Role override saved while an engine is removed", () => {
  it("is moved by the removal when the save started first, even though it is written after", async () => {
    const { role } = await roles.hireFromScratch(aCardOfItsOwn(), [], ANN_LEE);
    const hold = aHold();
    app.get(RoleOverrideChecks).register(async () => (await hold.wait(), []));

    const saving = roles.changeCard(
      role.key,
      { ...role.card, roleOverride: ON_RACING },
      [],
      ANN_LEE,
    );
    await hold.reached;
    let removed = false;
    const removing = removeRacing().then(() => (removed = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(removed).toBe(false);
    hold.release();
    await saving;
    await removing;

    expect((await roles.read(role.key)).role.card.roleOverride).toEqual({
      engineId: FIRST_CLAUDE_CODE_ENGINE.id,
      model: "claude-haiku-5-5",
    });
  });

  it("is refused when the removal started first, on the card and on a hire from scratch", async () => {
    const { role } = await roles.hireFromScratch(aCardOfItsOwn(), [], ANN_LEE);
    const hold = aHold();
    app.get(EngineReferenceMoves).register({ movesOf: async () => [], move: hold.wait });

    const removing = removeRacing();
    await hold.reached;
    const saving = roles.changeCard(
      role.key,
      { ...role.card, roleOverride: ON_RACING },
      [],
      ANN_LEE,
    );
    const hiring = roles.hireFromScratch(aCardOfItsOwn({ roleOverride: ON_RACING }), [], ANN_LEE);
    // Settled from now: the saves are refused while the removal still announces itself.
    const saves = Promise.allSettled([saving, hiring]);
    hold.release();
    await removing;

    const refused = { status: "rejected", reason: expect.any(RoleRefused) };
    expect(await saves).toEqual([refused, refused]);
    expect((await roles.read(role.key)).role.card.roleOverride).toBeNull();
  });
});

describe("removing an engine a Role override names", () => {
  it("previews the move it then makes", async () => {
    const { role } = await roles.hireFromScratch(
      aCardOfItsOwn({ roleOverride: ON_RACING }),
      [],
      ANN_LEE,
    );
    const settings = app.get(EngineSettingsService);

    const preview = await settings.removalPreview(RACING.id, FIRST_CLAUDE_CODE_ENGINE.id);
    await removeRacing();

    const moved = (await roles.read(role.key)).role.card.roleOverride;
    expect(moved).toEqual({ engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-haiku-5-5" });
    expect(preview).toEqual({
      moves: [{ roleKey: role.key, project: null, from: ON_RACING, to: moved }],
      problems: [],
    });
  });
});
