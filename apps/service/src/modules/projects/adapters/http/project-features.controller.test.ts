import type { INestApplication } from "@nestjs/common";
import {
  PROJECT_FEATURES as CONTRACT_PROJECT_FEATURES,
  projectRefusalSchema,
  projectSchema,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { PROJECT_FEATURES } from "../../domain/project-features.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";
import {
  createTemporaryRepository,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeAll(async () => {
  repository = await createTemporaryRepository();
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  ({ app, url } = await startProjectsApplication(repository));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

const { send, addProject, webEvents } = projectsHttp(() => ({ app, url, published, repository }));

describe("PUT /api/projects/:id/features", () => {
  it("switches the features named, keeps the others, and tells the web", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/features`, {
      features: { "github-issues": false },
    });

    expect(response.status).toBe(200);
    const expected = {
      "connected-devices": false,
      "test-targets": true,
      "github-issues": false,
      "run-environment": false,
      actions: true,
    };
    expect(projectSchema.parse(await response.json()).features).toEqual(expected);
    const read = projectSchema.parse(
      await (await fetch(`${url}/api/projects/${project.id}`)).json(),
    );
    expect(read.features).toEqual(expected);
    expect(webEvents()).toEqual([{ type: "project.features-changed", projectId: project.id }]);
  });

  it("refuses Connected devices on while Run environment isn't On, saying why", async () => {
    const project = await addProject();
    published = [];

    const response = await send("PUT", `/projects/${project.id}/features`, {
      features: { "connected-devices": true },
    });

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      `Connected devices need Run environment, which is off for «${project.name}».`,
    ]);
    expect(webEvents()).toEqual([]);
  });

  it("knows the features the contract names, in its order", () => {
    expect([...CONTRACT_PROJECT_FEATURES]).toEqual([...PROJECT_FEATURES]);
  });
});
