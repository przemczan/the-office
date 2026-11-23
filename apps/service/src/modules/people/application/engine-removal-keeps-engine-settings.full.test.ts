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
import { FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../../engine/index.js";
import {
  CodexApiKey,
  EngineSettingsForTests,
  EngineSettingsRepository,
  EngineSettingsService,
} from "../../engine/index.fixtures.js";
import type { PersonEngineSettings } from "../domain/role-card.js";
import { aRoleCard } from "../domain/role.fixtures.js";
import { ANN_LEE } from "../domain/user.fixtures.js";
import { PeopleModule } from "../people.module.js";
import { RoleService } from "./role-service.js";

// Engine settings of the test's own, so removing an engine leaves the shared database's alone;
// the Roles are in the shared database, so each test hires one of its own title.
const suffix = randomUUID().slice(0, 8);
const RACING = { ...FIRST_CLAUDE_CODE_ENGINE, id: `racing-${suffix}`, name: `Racing ${suffix}` };
const ONLY_CODEX: Engine = {
  id: `codex-${suffix}`,
  name: `Codex ${suffix}`,
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
  apiKey: CodexApiKey.of("sk-codex-kept"),
};
const SETTINGS: PersonEngineSettings = {
  "claude-code": { model: "claude-haiku-5-5", effort: "high" },
  codex: { model: "gpt-5.6-terra", effort: "low" },
};

let officeData: string;
let app: INestApplication;
let roles: RoleService;

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-engine-removal-"));
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
        useValue: new EngineSettingsForTests({
          engines: [FIRST_CLAUDE_CODE_ENGINE, RACING, ONLY_CODEX],
        }),
      },
    ],
  }));
  roles = app.get(RoleService);
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

async function aPersonWithEngineSettings(): Promise<string> {
  const card = aRoleCard({ title: `Racer ${randomUUID().slice(0, 8)}`, engineSettings: SETTINGS });
  const { role } = await roles.hireFromScratch(card, [], ANN_LEE);
  return role.key;
}

describe("removing an engine", () => {
  it("leaves people's model and effort for its engine type as they are", async () => {
    const key = await aPersonWithEngineSettings();
    const { cardVersion } = (await roles.read(key)).role;

    await app.get(EngineSettingsService).remove(RACING.id, FIRST_CLAUDE_CODE_ENGINE.id);

    const { role } = await roles.read(key);
    expect(role.card.engineSettings).toEqual(SETTINGS);
    expect(role.cardVersion).toBe(cardVersion);
  });

  it("keeps them for the last engine of its type, unused until one is listed again", async () => {
    const key = await aPersonWithEngineSettings();
    const { cardVersion } = (await roles.read(key)).role;

    await app.get(EngineSettingsService).remove(ONLY_CODEX.id, FIRST_CLAUDE_CODE_ENGINE.id);

    const { role } = await roles.read(key);
    expect(role.card.engineSettings).toEqual(SETTINGS);
    expect(role.cardVersion).toBe(cardVersion);
  });
});
