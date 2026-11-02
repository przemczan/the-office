import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable, Module, type INestApplication } from "@nestjs/common";
import { roleEngineCascadeSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { RoleService } from "../../application/role-service.js";
import type { ProjectWithCascadeLevels } from "../../domain/engine-cascade.js";
import { aRoleCard } from "../../domain/role.fixtures.js";
import { EngineCascadeModule } from "../../engine-cascade.module.js";
import { KnownPipelineRoles } from "../../ports/known-pipeline-roles.js";
import { KnownProjectLevels } from "../../ports/known-project-levels.js";
import { ProjectLevelsSaves } from "../../ports/project-levels-saves.js";

const haiku = { engineId: "claude-code", model: "claude-haiku-5-5" };

@Injectable()
class TwoProjects implements KnownProjectLevels {
  private readonly projects: readonly ProjectWithCascadeLevels[] = [
    {
      projectId: "forced",
      projectName: "Forced",
      projectDefault: haiku,
      useForEveryRole: true,
      roleOverrides: [],
    },
    {
      projectId: "quiet",
      projectName: "Quiet",
      projectDefault: null,
      useForEveryRole: false,
      roleOverrides: [],
    },
  ];

  async engineLevelsOf(projectId: string): Promise<ProjectWithCascadeLevels> {
    const project = this.projects.find((each) => each.projectId === projectId);
    if (!project) throw new Error(`No Project "${projectId}".`);
    return project;
  }

  async engineLevelsOfEveryProject(): Promise<readonly ProjectWithCascadeLevels[]> {
    return this.projects;
  }
}

/** No save of the Projects' levels to check, and no Pipeline naming a Role. */
@Injectable()
class NoChecks implements ProjectLevelsSaves, KnownPipelineRoles {
  register(): void {}

  async rolesNamed(): Promise<ReadonlySet<string>> {
    return new Set();
  }
}

@Module({ providers: [TwoProjects, NoChecks], exports: [TwoProjects, NoChecks] })
class TwoProjectsModule {}

let officeData: string;
let app: INestApplication;
let url: string;

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-engine-cascade-"));
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      EngineCascadeModule.register({
        imports: [TwoProjectsModule],
        knownProjectLevels: TwoProjects,
        projectLevelsSaves: NoChecks,
        knownPipelineRoles: NoChecks,
      }),
    ],
  }));
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

describe("GET /api/roles/:key/engine-cascade", () => {
  it("says what applies outside any Project and lists the Projects where something else does", async () => {
    const opus = { engineId: "claude-code", model: "claude-opus-5-5" };
    const card = aRoleCard({ title: `Cascade ${randomUUID().slice(0, 8)}`, roleOverride: opus });
    const { role } = await app.get(RoleService).hireFromScratch(card, []);

    const response = await fetch(`${url}/api/roles/${role.key}/engine-cascade`);

    expect(response.status).toBe(200);
    expect(roleEngineCascadeSchema.parse(await response.json())).toEqual({
      outsideProjects: { ...opus, level: "role-override" },
      elsewhereInProjects: [{ projectId: "forced", ...haiku, level: "project-default" }],
    });
  });

  it("answers 404 for a Role nobody fills", async () => {
    const response = await fetch(`${url}/api/roles/nobody-${randomUUID()}/engine-cascade`);

    expect(response.status).toBe(404);
  });
});
