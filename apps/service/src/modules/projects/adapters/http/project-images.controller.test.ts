import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { projectRefusalSchema, type Project } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TemporaryRepository } from "../git/temporary-repository.fixtures.js";
import {
  anImagesRepository,
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

const { pathOfFile, addProject, upload, uploaded, contentOf, removeImage, stored, officeData } =
  projectImagesHttp(() => ({
    url,
    repository,
    project,
    commit,
  }));

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
  it("keeps an uploaded Icon, read by what its bytes are", async () => {
    const { icon, logo } = await uploaded("icon/light", PNG);

    expect(icon.light?.mediaType).toBe("image/png");
    expect(icon.dark).toBeNull();
    expect(logo).toEqual({ light: null, dark: null });
    expect((await stored()).icon).toEqual(icon);
    await expect(access(pathOfFile(icon.light?.id ?? ""))).resolves.toBeUndefined();
  });

  it("keeps each version on its own, replacing and removing one leaves the other", async () => {
    const { logo: light } = await uploaded("logo/light", PNG);
    const { logo: both } = await uploaded("logo/dark", SVG_WITH_A_SCRIPT);
    const { logo: replaced } = await uploaded("logo/dark", PNG);

    expect(both).toEqual({ light: light.light, dark: expect.anything() });
    expect(replaced.light).toEqual(light.light);
    expect(replaced.dark?.id).not.toBe(both.dark?.id);
    await expect(access(pathOfFile(both.dark?.id ?? ""))).rejects.toThrow("ENOENT");

    const removed = await removeImage("logo/dark");

    expect(removed.status).toBe(200);
    expect((await stored()).logo).toEqual({ light: light.light, dark: null });
    await expect(access(pathOfFile(replaced.dark?.id ?? ""))).rejects.toThrow("ENOENT");
    expect((await contentOf(replaced.dark?.id)).status).toBe(404);
    expect((await contentOf(light.light?.id)).status).toBe(200);
  });

  it("refuses a palette it doesn't know", async () => {
    expect((await upload("icon/sepia", PNG)).status).toBe(400);
  });
});

describe("refusals", () => {
  it("refuses a file that is no image whatever is said of it, keeping the Project's", async () => {
    const { icon } = await uploaded("icon/light", PNG);

    const response = await upload("icon/light", new TextEncoder().encode("<html>a page</html>"));

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      "The file isn't a PNG, JPEG, WebP or SVG image.",
    ]);
    expect((await stored()).icon).toEqual(icon);
    expect(await readdir(join(officeData(), "project-images"))).toContain(icon.light?.id);
  });
});

describe("reading an image", () => {
  it("lets nothing in an SVG run or load when its address is opened", async () => {
    const { logo } = await uploaded("logo/light", SVG_WITH_A_SCRIPT);

    const { headers } = await contentOf(logo.light?.id);

    expect(headers.get("content-type")).toBe("image/svg+xml");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });
});
