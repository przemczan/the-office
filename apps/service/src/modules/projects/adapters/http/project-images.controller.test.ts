import { randomUUID } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  PROJECT_IMAGE_UPLOAD_BYTES,
  projectRefusalSchema,
  projectSchema,
  projectWebEventSchema,
  type NewProject,
  type Project,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { GitHubModule } from "../../../github/index.js";
import { PipelineLibrary, PipelineLibraryModule } from "../../../pipelines/index.js";
import { ProjectsModule } from "../../projects.module.js";
import {
  createTemporaryRepository,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);
const SVG_WITH_A_SCRIPT = new TextEncoder().encode(
  "<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
);

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let project: Project;

beforeAll(async () => {
  repository = await createTemporaryRepository();
});

afterAll(async () => {
  await repository.remove();
});

async function startService(): Promise<void> {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData()),
      ProjectsModule.register({
        imports: [PipelineLibraryModule, GitHubModule.register()],
        knownPipelines: PipelineLibrary,
      }),
    ],
  }));
}

beforeEach(async () => {
  await startService();
  project = await addProject();
});

afterEach(async () => {
  await app.close();
});

function officeData(): string {
  return join(repository.folder, "office-data");
}

function pathOfFile(imageId: string): string {
  return join(officeData(), "project-images", imageId);
}

async function addProject(): Promise<Project> {
  const newProject: NewProject = {
    name: `Imaged ${randomUUID().slice(0, 8)}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "IM", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const response = await fetch(`${url}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newProject),
  });
  return projectSchema.parse(await response.json());
}

function upload(image: string, content: Uint8Array, id = project.id): Promise<Response> {
  return fetch(`${url}/api/projects/${id}/images/${image}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: content,
  });
}

async function uploaded(image: string, content: Uint8Array): Promise<Project> {
  const response = await upload(image, content);
  expect(response.status).toBe(201);
  return projectSchema.parse(await response.json());
}

function removeImage(image: string): Promise<Response> {
  return fetch(`${url}/api/projects/${project.id}/images/${image}`, { method: "DELETE" });
}

function contentOf(imageId: string | undefined, id = project.id): Promise<Response> {
  return fetch(`${url}/api/projects/${id}/images/${imageId}/content`);
}

async function stored(): Promise<Project> {
  const response = await fetch(`${url}/api/projects/${project.id}`);
  return projectSchema.parse(await response.json());
}

async function expectGone(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow("ENOENT");
}

describe("a Project's images", () => {
  it("starts with neither", () => {
    expect(project).toMatchObject({ icon: null, logo: null });
  });

  it("keeps an uploaded Icon, read by what its bytes are", async () => {
    const { icon, logo } = await uploaded("icon", PNG);

    expect(icon?.mediaType).toBe("image/png");
    expect(logo).toBeNull();
    expect((await stored()).icon).toEqual(icon);
    await expect(access(pathOfFile(icon?.id ?? ""))).resolves.toBeUndefined();
  });

  it("keeps a Logo beside the Icon, and tells the web which changed", async () => {
    const published: DomainEvent[] = [];
    app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));

    const { logo } = await uploaded("logo", SVG_WITH_A_SCRIPT);

    expect(logo?.mediaType).toBe("image/svg+xml");
    const webEvent = app.get(WebEventForwarding).toWebEvent(published[0] as DomainEvent);
    expect(projectWebEventSchema.parse(webEvent)).toMatchObject({
      type: "project.image-changed",
      projectId: project.id,
      key: "logo",
    });
  });

  it("leaves the old file behind neither on replacing nor on removing", async () => {
    const first = await uploaded("icon", PNG);
    const second = await uploaded("icon", SVG_WITH_A_SCRIPT);

    expect(second.icon?.id).not.toBe(first.icon?.id);
    await expectGone(pathOfFile(first.icon?.id ?? ""));

    const response = await removeImage("icon");

    expect(response.status).toBe(200);
    expect(projectSchema.parse(await response.json()).icon).toBeNull();
    await expectGone(pathOfFile(second.icon?.id ?? ""));
  });
});

describe("refusals", () => {
  it("refuses a file that is no image whatever is said of it, keeping the Project's", async () => {
    const { icon } = await uploaded("icon", PNG);

    const response = await upload("icon", new TextEncoder().encode("<html>a page</html>"));

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      "The file isn't a PNG, JPEG, WebP or SVG image.",
    ]);
    expect((await stored()).icon).toEqual(icon);
    expect(await readdir(join(officeData(), "project-images"))).toContain(icon?.id);
  });

  it("refuses an empty file", async () => {
    const response = await upload("logo", new Uint8Array());

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      "The file is empty.",
    ]);
  });

  it("takes a file of exactly the limit and refuses one byte more", async () => {
    const atTheLimit = new Uint8Array(PROJECT_IMAGE_UPLOAD_BYTES);
    atTheLimit.set(PNG);
    await uploaded("logo", atTheLimit);

    const overIt = new Uint8Array(PROJECT_IMAGE_UPLOAD_BYTES + 1);
    overIt.set(PNG);
    const response = await upload("icon", overIt);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ message: "An upload may be at most 2 MB." });
    expect((await stored()).icon).toBeNull();
  });

  it("knows only the Icon and the Logo", async () => {
    expect((await upload("banner", PNG)).status).toBe(400);
    expect((await removeImage("banner")).status).toBe(400);
  });

  it("answers 404 for a Project that isn't there", async () => {
    expect((await upload("icon", PNG, "nowhere")).status).toBe(404);
    expect((await contentOf(randomUUID(), "nowhere")).status).toBe(404);
  });
});

describe("reading an image", () => {
  it("answers its bytes under the stored type", async () => {
    const { icon } = await uploaded("icon", PNG);

    const response = await contentOf(icon?.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("lets nothing in an SVG run or load when its address is opened", async () => {
    const { logo } = await uploaded("logo", SVG_WITH_A_SCRIPT);

    const { headers } = await contentOf(logo?.id);

    expect(headers.get("content-type")).toBe("image/svg+xml");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });

  it("can be cached for good, as its bytes never change", async () => {
    const { icon } = await uploaded("icon", PNG);

    const { headers } = await contentOf(icon?.id);

    expect(headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("is still there after the service restarts", async () => {
    const { icon } = await uploaded("icon", PNG);

    await app.close();
    await startService();

    expect((await stored()).icon).toEqual(icon);
    expect(new Uint8Array(await (await contentOf(icon?.id)).arrayBuffer())).toEqual(PNG);
  });

  it("answers 404 for an image the Project no longer holds, or never did", async () => {
    const { icon } = await uploaded("icon", PNG);
    await removeImage("icon");

    expect((await contentOf(icon?.id)).status).toBe(404);
    expect((await contentOf(randomUUID())).status).toBe(404);
  });

  it("answers only the Project that holds the image", async () => {
    const { icon } = await uploaded("icon", PNG);
    const other = await addProject();

    expect((await contentOf(icon?.id, other.id)).status).toBe(404);
  });
});
