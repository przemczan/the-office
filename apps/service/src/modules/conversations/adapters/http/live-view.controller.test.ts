import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { liveViewSchema, liveViewWebEventSchema } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { GitHubModule } from "../../../github/index.js";
import { EngineCascadeModule, RoleHired } from "../../../people/index.js";
import {
  aRole,
  RoleRepository,
  WorkLevelsForTests,
  WorkLevelsForTestsModule,
} from "../../../people/index.fixtures.js";
import { PipelineLibrary, PipelineLibraryModule } from "../../../pipelines/index.js";
import {
  BaseCheckouts,
  EngineLevelsChecks,
  ProjectRecords,
  ProjectService,
  ProjectsModule,
} from "../../../projects/index.js";
import { ConversationsModule } from "../../conversations.module.js";
import { LiveViewChanged } from "../../domain/conversation-events.js";

let app: INestApplication;
let url: string;
let officeData: string;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-live-view-"));
  // As AppModule builds them, so the Live view reads the real People.
  const projects = ProjectsModule.register({
    imports: [PipelineLibraryModule, GitHubModule.register()],
    knownPipelines: PipelineLibrary,
  });
  const engineCascade = EngineCascadeModule.register({
    imports: [projects, PipelineLibraryModule, WorkLevelsForTestsModule],
    knownProjectLevels: ProjectService,
    knownWorkLevels: WorkLevelsForTests,
    projectLevelsSaves: EngineLevelsChecks,
  });
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      projects,
      ConversationsModule.register({
        imports: [projects, engineCascade],
        projectBases: BaseCheckouts,
        projectOutputMasks: ProjectService,
        projectRecords: ProjectRecords,
      }),
    ],
  }));
});

afterAll(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

describe("GET /live-view", () => {
  it("answers each person filling a Role, and sends each change whole to the web", async () => {
    // Tests share the database, so only this test's own Roles are looked at.
    const roles = app.get(RoleRepository, { strict: false });
    const oscar = aRole({ key: `developer-${randomUUID()}` });
    const clara = aRole({
      key: `cto-${randomUUID()}`,
      hiredAt: new Date(oscar.hiredAt.getTime() + 60_000),
    });
    const ours = (people: readonly { readonly roleKey: string }[]) =>
      people.filter(({ roleKey }) => [oscar.key, clara.key].includes(roleKey));
    await roles.add(oscar);
    const events = app.get(EventBus);
    const announced: LiveViewChanged[] = [];
    events.subscribe(LiveViewChanged, (event) => void announced.push(event));

    const response = await fetch(`${url}/api/live-view`);
    const liveView = liveViewSchema.parse(await response.json());
    await roles.add(clara);
    await events.publish(new RoleHired(clara));
    const event = await vi.waitFor(() => {
      const [first] = announced;
      if (!first) throw new Error("Nothing was announced.");
      return first;
    });
    const webEvent = liveViewWebEventSchema.parse(app.get(WebEventForwarding).toWebEvent(event));

    expect(response.status).toBe(200);
    expect(ours(liveView.people)).toEqual([
      {
        roleKey: oscar.key,
        name: oscar.card.name,
        title: oscar.card.title,
        state: "idle",
        agents: [],
        consulting: [],
        waitingOnYou: [],
        idleSince: oscar.hiredAt.toISOString(),
      },
    ]);
    expect(ours(webEvent.liveView.people).map(({ roleKey }) => roleKey)).toEqual([
      oscar.key,
      clara.key,
    ]);
  });
});
