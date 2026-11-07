import { randomUUID } from "node:crypto";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  IMAGE_UPLOAD_BYTES,
  roleChangeListSchema,
  roleRefusalSchema,
  roleSchema,
  roleWebEventSchema,
  type Role,
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
import { CARETAKER } from "../../domain/known-roles.js";
import { aRoleCard } from "../../domain/role.fixtures.js";
import { PeopleModule } from "../../people.module.js";

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);
const SVG_WITH_A_SCRIPT = new TextEncoder().encode(
  "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
);

let officeData: string;
let app: INestApplication;
let url: string;
let person: Role;

async function startService(): Promise<void> {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      PeopleModule,
    ],
  }));
}

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-avatars-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  await startService();
  person = await hire("Ada");
});

afterEach(async () => {
  await app.close();
});

/** Someone in a Role of their own: every test file shares the database. */
async function hire(name: string): Promise<Role> {
  const card = { ...aRoleCard({ name, title: `Painter ${randomUUID().slice(0, 8)}` }), skills: [] };
  const response = await fetch(`${url}/api/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card }),
  });
  expect(response.status).toBe(201);
  return roleSchema.parse(await response.json());
}

function pathOfFile(imageId: string): string {
  return join(officeData, "avatars", imageId);
}

function upload(content: Uint8Array, key = person.key): Promise<Response> {
  return fetch(`${url}/api/roles/${key}/avatar`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: content,
  });
}

async function uploaded(content: Uint8Array, key = person.key): Promise<Role> {
  const response = await upload(content, key);
  expect(response.status).toBe(201);
  return roleSchema.parse(await response.json());
}

function removeAvatar(key = person.key): Promise<Response> {
  return fetch(`${url}/api/roles/${key}/avatar`, { method: "DELETE" });
}

function contentOf(imageId: string | undefined, key = person.key): Promise<Response> {
  return fetch(`${url}/api/roles/${key}/avatar/${imageId}/content`);
}

async function stored(key = person.key): Promise<Role> {
  const response = await fetch(`${url}/api/roles/${key}`);
  return roleSchema.parse(await response.json());
}

async function changesOf(key = person.key): Promise<unknown[]> {
  const response = await fetch(`${url}/api/roles/${key}/changes`);
  return roleChangeListSchema.parse(await response.json());
}

function post(path: string): Promise<Response> {
  return fetch(`${url}/api/roles/${person.key}/${path}`, { method: "POST" });
}

async function expectGone(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow("ENOENT");
}

async function expectRefused(response: Response, reasons: readonly string[]): Promise<void> {
  expect(response.status).toBe(422);
  expect(roleRefusalSchema.parse(await response.json()).reasons).toEqual(reasons);
}

describe("a person's Avatar", () => {
  it("starts with none", () => {
    expect(person.avatar).toBeNull();
  });

  it("is kept by what its bytes are, and tells the web", async () => {
    const published: DomainEvent[] = [];
    app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));

    const { avatar } = await uploaded(PNG);

    expect(avatar?.mediaType).toBe("image/png");
    expect((await stored()).avatar).toEqual(avatar);
    await expect(access(pathOfFile(avatar?.id ?? ""))).resolves.toBeUndefined();
    const webEvent = app.get(WebEventForwarding).toWebEvent(published[0] as DomainEvent);
    expect(roleWebEventSchema.parse(webEvent)).toMatchObject({
      type: "role.avatar-changed",
      roleKey: person.key,
    });
  });

  it("leaves the old file behind neither on replacing nor on removing", async () => {
    const first = await uploaded(PNG);
    const second = await uploaded(SVG_WITH_A_SCRIPT);

    expect(second.avatar?.id).not.toBe(first.avatar?.id);
    await expectGone(pathOfFile(first.avatar?.id ?? ""));

    const response = await removeAvatar();

    expect(response.status).toBe(200);
    expect(roleSchema.parse(await response.json()).avatar).toBeNull();
    await expectGone(pathOfFile(second.avatar?.id ?? ""));
  });

  it("adds no card version and no entry to the card's changes", async () => {
    const before = await changesOf();

    await uploaded(PNG);
    await uploaded(SVG_WITH_A_SCRIPT);
    await removeAvatar();

    expect((await stored()).cardVersion).toBe(person.cardVersion);
    expect(await changesOf()).toEqual(before);
  });

  it("is each person's own, even under the same name", async () => {
    const namesake = await hire("Ada");

    const { avatar } = await uploaded(PNG);

    expect(avatar).not.toBeNull();
    expect((await stored(namesake.key)).avatar).toBeNull();
    expect((await contentOf(avatar?.id, namesake.key)).status).toBe(404);
  });

  it("can be the Caretaker's", async () => {
    const { avatar } = await uploaded(PNG, CARETAKER);

    expect(avatar?.mediaType).toBe("image/png");

    expect((await removeAvatar(CARETAKER)).status).toBe(200);
  });
});

describe("refusals", () => {
  it("refuses a file that is no image whatever is said of it, keeping the person's", async () => {
    const { avatar } = await uploaded(PNG);

    await expectRefused(await upload(new TextEncoder().encode("<html>a page</html>")), [
      "The file isn't a PNG, JPEG, WebP or SVG image.",
    ]);

    expect((await stored()).avatar).toEqual(avatar);
    expect(await readdir(join(officeData, "avatars"))).toContain(avatar?.id);
  });

  it("refuses an empty file", async () => {
    await expectRefused(await upload(new Uint8Array()), ["The file is empty."]);

    expect((await stored()).avatar).toBeNull();
  });

  it("takes a file of exactly the limit and refuses one byte more", async () => {
    const atTheLimit = new Uint8Array(IMAGE_UPLOAD_BYTES);
    atTheLimit.set(PNG);
    const { avatar } = await uploaded(atTheLimit);

    const overIt = new Uint8Array(IMAGE_UPLOAD_BYTES + 1);
    overIt.set(PNG);
    const response = await upload(overIt);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ message: "An upload may be at most 2 MB." });
    expect((await stored()).avatar).toEqual(avatar);
  });

  it("keeps showing the Avatar of someone let go, unchanged until they are hired back", async () => {
    const { avatar } = await uploaded(PNG);
    await post("let-go");
    const refusal = `Ada was let go from the ${person.card.title} Role; hire Ada back to change their Avatar.`;

    await expectRefused(await upload(SVG_WITH_A_SCRIPT), [refusal]);
    await expectRefused(await removeAvatar(), [refusal]);

    expect((await stored()).avatar).toEqual(avatar);
    expect((await contentOf(avatar?.id)).status).toBe(200);
    expect(await readdir(join(officeData, "avatars"))).toContain(avatar?.id);

    await post("hire-back");
    expect((await removeAvatar()).status).toBe(200);
  });

  it("answers 404 for a Role that isn't there", async () => {
    expect((await upload(PNG, "nobody")).status).toBe(404);
    expect((await removeAvatar("nobody")).status).toBe(404);
    expect((await contentOf(randomUUID(), "nobody")).status).toBe(404);
  });
});

describe("reading an Avatar", () => {
  it("answers its bytes under the stored type", async () => {
    const { avatar } = await uploaded(PNG);

    const response = await contentOf(avatar?.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("lets nothing in an SVG run or load when its address is opened", async () => {
    const { avatar } = await uploaded(SVG_WITH_A_SCRIPT);

    const { headers } = await contentOf(avatar?.id);

    expect(headers.get("content-type")).toBe("image/svg+xml");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });

  it("can be cached for good, as its bytes never change", async () => {
    const { avatar } = await uploaded(PNG);

    const { headers } = await contentOf(avatar?.id);

    expect(headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("is still there after the service restarts", async () => {
    const { avatar } = await uploaded(PNG);

    await app.close();
    await startService();

    expect((await stored()).avatar).toEqual(avatar);
    expect(new Uint8Array(await (await contentOf(avatar?.id)).arrayBuffer())).toEqual(PNG);
  });

  it("answers 404 for an Avatar the person no longer holds, or never did", async () => {
    const { avatar } = await uploaded(PNG);
    await removeAvatar();

    expect((await contentOf(avatar?.id)).status).toBe(404);
    expect((await contentOf(randomUUID())).status).toBe(404);
  });
});
