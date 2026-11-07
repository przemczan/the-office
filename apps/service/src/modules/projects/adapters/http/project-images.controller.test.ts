import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  IMAGE_UPLOAD_BYTES,
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
  gitIn,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);
/** A PNG's signature, then bytes that are no UTF-8. */
const BINARY_PNG = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0xff,
  0xfe,
  0,
  0x80,
);
const SVG_WITH_A_SCRIPT = new TextEncoder().encode(
  "<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
);

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let project: Project;
let commit: string;

/** The files of `images/`, committed; answers the commit. */
async function commitImages(files: Readonly<Record<string, Uint8Array | string>>): Promise<string> {
  await mkdir(join(repository.path, "images"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(repository.path, "images", name), content);
  }
  gitIn(repository.path, "add", ".");
  gitIn(repository.path, "commit", "--quiet", "--message", "Change the images");
  return gitIn(repository.path, "rev-parse", "HEAD");
}

beforeAll(async () => {
  repository = await createTemporaryRepository();
  const atTheLimit = new Uint8Array(IMAGE_UPLOAD_BYTES);
  atTheLimit.set(BINARY_PNG);
  const overIt = new Uint8Array(IMAGE_UPLOAD_BYTES + 1);
  overIt.set(BINARY_PNG);
  commit = await commitImages({
    "icon.png": BINARY_PNG,
    "logo.svg": SVG_WITH_A_SCRIPT,
    "fake.png": "<html>a page</html>",
    "empty.png": "",
    "at-the-limit.png": atTheLimit,
    "over-it.png": overIt,
  });
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

async function addProject(path = repository.path): Promise<Project> {
  const newProject: NewProject = {
    name: `Imaged ${randomUUID().slice(0, 8)}`,
    path,
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

function choose(image: string, file: unknown, id = project.id): Promise<Response> {
  return fetch(`${url}/api/projects/${id}/images/${image}/from-repository`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(file),
  });
}

async function chosen(image: string, path: string, at = commit): Promise<Project> {
  const response = await choose(image, { commit: at, path });
  expect(response.status).toBe(201);
  return projectSchema.parse(await response.json());
}

async function expectRefused(response: Response, reasons: readonly unknown[]): Promise<void> {
  expect(response.status).toBe(422);
  expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual(reasons);
}

async function bytesOf(imageId: string | undefined): Promise<Uint8Array> {
  return new Uint8Array(await (await contentOf(imageId)).arrayBuffer());
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
    const atTheLimit = new Uint8Array(IMAGE_UPLOAD_BYTES);
    atTheLimit.set(PNG);
    await uploaded("logo", atTheLimit);

    const overIt = new Uint8Array(IMAGE_UPLOAD_BYTES + 1);
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

describe("choosing an image from the repository", () => {
  it("keeps a byte-for-byte copy of the file at the commit, read by what its bytes are", async () => {
    const { icon } = await chosen("icon", "images/icon.png");

    expect(icon?.mediaType).toBe("image/png");
    expect(await bytesOf(icon?.id)).toEqual(BINARY_PNG);
  });

  it("tells the web, and replaces and removes as an upload does", async () => {
    const published: DomainEvent[] = [];
    const first = await uploaded("logo", PNG);
    app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));

    const second = await chosen("logo", "images/logo.svg");

    expect(second.logo?.mediaType).toBe("image/svg+xml");
    await expectGone(pathOfFile(first.logo?.id ?? ""));
    const webEvent = app.get(WebEventForwarding).toWebEvent(published[0] as DomainEvent);
    expect(projectWebEventSchema.parse(webEvent)).toMatchObject({
      type: "project.image-changed",
      projectId: project.id,
      key: "logo",
    });

    expect((await removeImage("logo")).status).toBe(200);
    await expectGone(pathOfFile(second.logo?.id ?? ""));
  });

  it("leaves the copy as it was once the file changes, until it is chosen again", async () => {
    const { icon } = await chosen("icon", "images/icon.png");

    const later = await commitImages({ "icon.png": PNG });

    expect((await stored()).icon).toEqual(icon);
    expect(await bytesOf(icon?.id)).toEqual(BINARY_PNG);

    const again = await chosen("icon", "images/icon.png", later);
    expect(again.icon?.id).not.toBe(icon?.id);
    expect(await bytesOf(again.icon?.id)).toEqual(PNG);
  });

  it("stores nothing of the file's path or commit with the Project", async () => {
    await chosen("logo", "images/logo.svg");

    const held = JSON.stringify(await stored());

    expect(held).not.toContain("images/logo.svg");
    expect(held).not.toContain(commit);
  });

  it("takes a file of exactly the limit and refuses one byte more, in the upload's words", async () => {
    await chosen("logo", "images/at-the-limit.png");

    await expectRefused(await choose("icon", { commit, path: "images/over-it.png" }), [
      "An image may be at most 2 MB.",
    ]);
    expect((await stored()).icon).toBeNull();
  });

  it("refuses a file that is no image whatever its name says, keeping the Project's", async () => {
    const { icon } = await chosen("icon", "images/icon.png");

    await expectRefused(await choose("icon", { commit, path: "images/fake.png" }), [
      "The file isn't a PNG, JPEG, WebP or SVG image.",
    ]);
    await expectRefused(await choose("icon", { commit, path: "images/empty.png" }), [
      "The file is empty.",
    ]);
    expect((await stored()).icon).toEqual(icon);
  });

  it("refuses a commit or path that isn't in the repository, never a server error", async () => {
    const noCommit = "0".repeat(40);

    await expectRefused(await choose("icon", { commit: noCommit, path: "images/icon.png" }), [
      `The repository holds no commit ${noCommit}.`,
    ]);
    await expectRefused(await choose("icon", { commit, path: "images/none.png" }), [
      "The repository has no file images/none.png at this commit.",
    ]);
    await expectRefused(await choose("icon", { commit, path: "images" }), [
      "The repository has no file images at this commit.",
    ]);
    await expectRefused(await choose("icon", { commit, path: "../secret.png" }), [
      "../secret.png is not a path inside the repository.",
    ]);
    expect((await stored()).icon).toBeNull();
  });

  it("refuses plainly when the Project's folder has gone from the workstation", async () => {
    const gone = await createTemporaryRepository();
    const goneProject = await addProject(gone.path);
    await gone.remove();

    const fetched = await fetch(`${url}/api/projects/${goneProject.id}/base-branch/fetch`, {
      method: "POST",
    });
    const response = await choose("icon", { commit, path: "images/icon.png" }, goneProject.id);

    expect(fetched.status).toBe(422);
    await expectRefused(response, [`The repository holds no commit ${commit}.`]);
  });

  it("wants a commit and a path, and knows only the Icon and the Logo", async () => {
    expect((await choose("icon", { commit })).status).toBe(400);
    expect((await choose("banner", { commit, path: "images/icon.png" })).status).toBe(400);
  });

  it("answers 404 for a Project that isn't there", async () => {
    expect((await choose("icon", { commit, path: "images/icon.png" }, "nowhere")).status).toBe(404);
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
