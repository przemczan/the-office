import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  projectRemoteNeedsSchema,
  projectSchema,
  projectWebEventSchema,
  type NewProject,
  type Project,
  type ProjectRemoteNeeds,
} from "@the-office/contracts";
import { expect } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { EventsModule } from "../../platform/events/events.module.js";
import type { DomainEvent } from "../../platform/events/domain-event.js";
import { OfficeDataModule } from "../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../platform/telemetry/telemetry.module.js";
import { EngineModule, ScriptedEngine, ScriptedEngineModule } from "../engine/index.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../platform/websocket/web-event-forwarding.js";
import { GitHubModule } from "../github/index.js";
import { PipelineLibrary, PipelineLibraryModule } from "../pipelines/index.js";
import { ProjectsModule } from "./projects.module.js";
import { TaskBases } from "./application/task-bases.js";
import type { TemporaryRepository } from "./adapters/git/temporary-repository.fixtures.js";

/** The Projects module's routes on the test database. */
export async function startProjectsApplication(
  repository: TemporaryRepository,
): Promise<{ app: INestApplication; url: string }> {
  const { app, url } = await startTestApplication({
    database: true,
    moduleOverrides: [
      { module: EngineModule, useModule: ScriptedEngineModule.register(new ScriptedEngine([])) },
    ],
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(join(repository.folder, "office-data")),
      ProjectsModule.register({
        imports: [PipelineLibraryModule, GitHubModule.register()],
        knownPipelines: PipelineLibrary,
      }),
    ],
  });
  // Work's lookup stood in for: no Task here has an Initiative.
  app.get(TaskBases).register(async () => ({ kind: "base-branch" }));
  return { app, url };
}

/** The requests the Projects routes' tests share, on the app and repository `current` gives. */
export function projectsHttp(
  current: () => {
    readonly app: INestApplication;
    readonly url: string;
    readonly published: readonly DomainEvent[];
    readonly repository: TemporaryRepository;
  },
) {
  /** A Project of the test's own name, since every test file shares the database. */
  function aNewProject(fields: Partial<NewProject> = {}): NewProject {
    return {
      name: `Admin panel ${randomUUID().slice(0, 8)}`,
      path: current().repository.path,
      baseBranch: "main",
      mark: { label: "AP", colour: "teal" },
      installCommand: "npm ci",
      commands: [
        {
          key: "build",
          name: "Build",
          kind: "build",
          commandLine: "npm run build",
          rerunCommandLine: "",
        },
        {
          key: "lint",
          name: "Lint",
          kind: "lint",
          commandLine: "npm run lint",
          rerunCommandLine: "",
        },
        { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
      ],
      installInputs: ["package-lock.json"],
      publishingMode: "push-and-pull-request",
      defaultPipeline: "full",
      ...fields,
    };
  }

  function send(
    method: "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${current().url}/api${path}`, {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  }

  async function addProject(fields: Partial<NewProject> = {}): Promise<Project> {
    const response = await send("POST", "/projects", aNewProject(fields));
    expect(response.status).toBe(201);
    return projectSchema.parse(await response.json());
  }

  async function remoteNeedsOf(project: Project): Promise<ProjectRemoteNeeds["remoteNeeds"]> {
    const response = await fetch(`${current().url}/api/projects/${project.id}/remote-needs`);
    expect(response.status).toBe(200);
    return projectRemoteNeedsSchema.parse(await response.json()).remoteNeeds;
  }

  /** The events published so far, as the web receives them. */
  function webEvents(): unknown[] {
    const { app, published } = current();
    const forwarding = app.get(WebEventForwarding);
    return published.map((event) => {
      const { occurredAt: _occurredAt, ...webEvent } = projectWebEventSchema.parse(
        forwarding.toWebEvent(event),
      );
      return webEvent;
    });
  }

  return { aNewProject, send, addProject, remoteNeedsOf, webEvents };
}
