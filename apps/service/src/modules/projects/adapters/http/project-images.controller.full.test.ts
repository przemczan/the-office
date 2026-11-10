import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  IMAGE_UPLOAD_BYTES,
  projectRefusalSchema,
  projectSchema,
  projectWebEventSchema,
  type Project,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  createTemporaryRepository,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import {
  anImagesRepository,
  BINARY_PNG,
  PNG,
  projectImagesHttp,
  SVG_WITH_A_SCRIPT,
} from "./project-images.controller.fixtures.js";
import { startProjectsApplication } from "../../projects.controller.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let project: Project;
let commit: string;

const {
  commitImages,
  pathOfFile,
  addProject,
  upload,
  uploaded,
  choose,
  chosen,
  expectRefused,
  bytesOf,
  removeImage,
  contentOf,
  stored,
  expectGone,
} = projectImagesHttp(() => ({ url, repository, project, commit }));

beforeAll(async () => {
  ({ repository, commit } = await anImagesRepository());
});

afterAll(async () => {
  await repository.remove();
});

async function startService(): Promise<void> {
  ({ app, url } = await startProjectsApplication(repository));
}

beforeEach(async () => {
  await startService();
  project = await addProject();
});

afterEach(async () => {
  await app.close();
});

describe("a Project's images", () => {
  it("starts with neither", () => {
    expect(project).toMatchObject({
      icon: { light: null, dark: null },
      logo: { light: null, dark: null },
    });
  });

  it("keeps a Logo beside the Icon, and tells the web which changed", async () => {
    const published: DomainEvent[] = [];
    app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));

    const { logo } = await uploaded("logo/light", SVG_WITH_A_SCRIPT);

    expect(logo.light?.mediaType).toBe("image/svg+xml");
    const webEvent = app.get(WebEventForwarding).toWebEvent(published[0] as DomainEvent);
    expect(projectWebEventSchema.parse(webEvent)).toMatchObject({
      type: "project.image-changed",
      projectId: project.id,
      key: "logo",
    });
  });

  it("leaves the old file behind neither on replacing nor on removing", async () => {
    const first = await uploaded("icon/light", PNG);
    const second = await uploaded("icon/light", SVG_WITH_A_SCRIPT);

    expect(second.icon.light?.id).not.toBe(first.icon.light?.id);
    await expectGone(pathOfFile(first.icon.light?.id ?? ""));

    const response = await removeImage("icon/light");

    expect(response.status).toBe(200);
    expect(projectSchema.parse(await response.json()).icon.light).toBeNull();
    await expectGone(pathOfFile(second.icon.light?.id ?? ""));
  });
});

describe("refusals", () => {
  it("refuses an empty file", async () => {
    const response = await upload("logo/light", new Uint8Array());

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      "The file is empty.",
    ]);
  });

  it("takes a file of exactly the limit and refuses one byte more", async () => {
    const atTheLimit = new Uint8Array(IMAGE_UPLOAD_BYTES);
    atTheLimit.set(PNG);
    await uploaded("logo/light", atTheLimit);

    const overIt = new Uint8Array(IMAGE_UPLOAD_BYTES + 1);
    overIt.set(PNG);
    const response = await upload("icon/light", overIt);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ message: "An upload may be at most 2 MB." });
    expect((await stored()).icon.light).toBeNull();
  });

  it("knows only the Icon and the Logo", async () => {
    expect((await upload("banner/light", PNG)).status).toBe(400);
    expect((await removeImage("banner/light")).status).toBe(400);
  });

  it("answers 404 for a Project that isn't there", async () => {
    expect((await upload("icon/light", PNG, "nowhere")).status).toBe(404);
    expect((await contentOf(randomUUID(), "nowhere")).status).toBe(404);
  });
});

describe("choosing an image from the repository", () => {
  it("keeps a byte-for-byte copy of the file at the commit, read by what its bytes are", async () => {
    const { icon } = await chosen("icon/light", "images/icon.png");

    expect(icon.light?.mediaType).toBe("image/png");
    expect(await bytesOf(icon.light?.id)).toEqual(BINARY_PNG);
  });

  it("tells the web, and replaces and removes as an upload does", async () => {
    const published: DomainEvent[] = [];
    const first = await uploaded("logo/light", PNG);
    app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));

    const second = await chosen("logo/light", "images/logo.svg");

    expect(second.logo.light?.mediaType).toBe("image/svg+xml");
    await expectGone(pathOfFile(first.logo.light?.id ?? ""));
    const webEvent = app.get(WebEventForwarding).toWebEvent(published[0] as DomainEvent);
    expect(projectWebEventSchema.parse(webEvent)).toMatchObject({
      type: "project.image-changed",
      projectId: project.id,
      key: "logo",
    });

    expect((await removeImage("logo/light")).status).toBe(200);
    await expectGone(pathOfFile(second.logo.light?.id ?? ""));
  });

  it("leaves the copy as it was once the file changes, until it is chosen again", async () => {
    const { icon } = await chosen("icon/light", "images/icon.png");

    const later = await commitImages({ "icon.png": PNG });

    expect((await stored()).icon).toEqual(icon);
    expect(await bytesOf(icon.light?.id)).toEqual(BINARY_PNG);

    const again = await chosen("icon/light", "images/icon.png", later);
    expect(again.icon.light?.id).not.toBe(icon.light?.id);
    expect(await bytesOf(again.icon.light?.id)).toEqual(PNG);
  });

  it("stores nothing of the file's path or commit with the Project", async () => {
    await chosen("logo/light", "images/logo.svg");

    const held = JSON.stringify(await stored());

    expect(held).not.toContain("images/logo.svg");
    expect(held).not.toContain(commit);
  });

  it("takes a file of exactly the limit and refuses one byte more, in the upload's words", async () => {
    await chosen("logo/light", "images/at-the-limit.png");

    await expectRefused(await choose("icon/light", { commit, path: "images/over-it.png" }), [
      "An image may be at most 2 MB.",
    ]);
    expect((await stored()).icon.light).toBeNull();
  });

  it("refuses a file that is no image whatever its name says, keeping the Project's", async () => {
    const { icon } = await chosen("icon/light", "images/icon.png");

    await expectRefused(await choose("icon/light", { commit, path: "images/fake.png" }), [
      "The file isn't a PNG, JPEG, WebP or SVG image.",
    ]);
    await expectRefused(await choose("icon/light", { commit, path: "images/empty.png" }), [
      "The file is empty.",
    ]);
    expect((await stored()).icon).toEqual(icon);
  });

  it("refuses a commit or path that isn't in the repository, never a server error", async () => {
    const noCommit = "0".repeat(40);

    await expectRefused(await choose("icon/light", { commit: noCommit, path: "images/icon.png" }), [
      `The repository holds no commit ${noCommit}.`,
    ]);
    await expectRefused(await choose("icon/light", { commit, path: "images/none.png" }), [
      "The repository has no file images/none.png at this commit.",
    ]);
    await expectRefused(await choose("icon/light", { commit, path: "images" }), [
      "The repository has no file images at this commit.",
    ]);
    await expectRefused(await choose("icon/light", { commit, path: "../secret.png" }), [
      "../secret.png is not a path inside the repository.",
    ]);
    expect((await stored()).icon.light).toBeNull();
  });

  it("refuses plainly when the Project's folder has gone from the workstation", async () => {
    const gone = await createTemporaryRepository();
    const goneProject = await addProject(gone.path);
    await gone.remove();

    const fetched = await fetch(`${url}/api/projects/${goneProject.id}/base-branch/fetch`, {
      method: "POST",
    });
    const response = await choose(
      "icon/light",
      { commit, path: "images/icon.png" },
      goneProject.id,
    );

    expect(fetched.status).toBe(422);
    await expectRefused(response, [`The repository holds no commit ${commit}.`]);
  });

  it("wants a commit and a path, and knows only the Icon and the Logo", async () => {
    expect((await choose("icon/light", { commit })).status).toBe(400);
    expect((await choose("banner/light", { commit, path: "images/icon.png" })).status).toBe(400);
  });

  it("answers 404 for a Project that isn't there", async () => {
    expect(
      (await choose("icon/light", { commit, path: "images/icon.png" }, "nowhere")).status,
    ).toBe(404);
  });
});

describe("reading an image", () => {
  it("answers its bytes under the stored type", async () => {
    const { icon } = await uploaded("icon/light", PNG);

    const response = await contentOf(icon.light?.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("can be cached for good, as its bytes never change", async () => {
    const { icon } = await uploaded("icon/light", PNG);

    const { headers } = await contentOf(icon.light?.id);

    expect(headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("is still there after the service restarts", async () => {
    const { icon } = await uploaded("icon/light", PNG);

    await app.close();
    await startService();

    expect((await stored()).icon).toEqual(icon);
    expect(new Uint8Array(await (await contentOf(icon.light?.id)).arrayBuffer())).toEqual(PNG);
  });

  it("answers 404 for an image the Project no longer holds, or never did", async () => {
    const { icon } = await uploaded("icon/light", PNG);
    await removeImage("icon/light");

    expect((await contentOf(icon.light?.id)).status).toBe(404);
    expect((await contentOf(randomUUID())).status).toBe(404);
  });

  it("answers only the Project that holds the image", async () => {
    const { icon } = await uploaded("icon/light", PNG);
    const other = await addProject();

    expect((await contentOf(icon.light?.id, other.id)).status).toBe(404);
  });
});
