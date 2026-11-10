import { randomUUID } from "node:crypto";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { roleSchema, roleWebEventSchema, type Role } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { aRoleCard } from "../../domain/role.fixtures.js";
import { PeopleModule } from "../../people.module.js";
import { PNG, SVG_WITH_A_SCRIPT, expectRefused } from "./avatars.controller.fixtures.js";

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

function contentOf(imageId: string | undefined, key = person.key): Promise<Response> {
  return fetch(`${url}/api/roles/${key}/avatar/${imageId}/content`);
}

async function stored(key = person.key): Promise<Role> {
  const response = await fetch(`${url}/api/roles/${key}`);
  return roleSchema.parse(await response.json());
}

describe("a person's Avatar", () => {
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
});

describe("reading an Avatar", () => {
  it("lets nothing in an SVG run or load when its address is opened", async () => {
    const { avatar } = await uploaded(SVG_WITH_A_SCRIPT);

    const { headers } = await contentOf(avatar?.id);

    expect(headers.get("content-type")).toBe("image/svg+xml");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });
});
