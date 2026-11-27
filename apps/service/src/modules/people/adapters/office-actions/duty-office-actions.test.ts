import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  dutySchema,
  presetListSchema,
  roleRefusalSchema,
  roleSchema,
  SET_DUTY_HOLDER_ACTION,
} from "@the-office/contracts";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
import { DutyRepository } from "../../ports/duty-repository.js";
import { DutyRepositoryForTests } from "../../ports/duty-repository.fixtures.js";
import { PeopleModule } from "../../people.module.js";
import { roles } from "../postgres/roles.schema.js";

// The duties are kept in memory, as in duties.controller.test.ts; the Roles are the test's own.
let officeData: string;
let app: INestApplication;
let url: string;
let hiredKeys: string[];

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-duty-actions-"));
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      PeopleModule,
    ],
    overrides: [{ provide: DutyRepository, useValue: new DutyRepositoryForTests() }],
  }));
  hiredKeys = [];
});

afterEach(async () => {
  await app.get<Database>(DATABASE).delete(roles).where(inArray(roles.key, hiredKeys));
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function hireOwn(name: string): Promise<{ key: string; title: string }> {
  const presets = presetListSchema.parse(await (await send("GET", "/presets")).json());
  const developer = presets[1];
  if (!developer) throw new Error("The Developer preset is missing.");
  const title = `Lead ${randomUUID().slice(0, 8)}`;
  const response = await send("POST", "/roles", {
    card: { ...developer.card, name, title, skills: [] },
  });
  expect(response.status).toBe(201);
  const { key } = roleSchema.parse(await response.json());
  hiredKeys.push(key);
  return { key, title };
}

function toolOf(): OfficeTool {
  const [tool] = app.get(OfficeToolRegistry).named([SET_DUTY_HOLDER_ACTION.name], RUN_EVERY_CALL);
  if (!tool) throw new Error("set_duty_holder is not registered.");
  return tool;
}

describe("set_duty_holder", () => {
  it("is carried out by a person's call, in words, and by the route alike", async () => {
    const { key } = await hireOwn("Lea");
    const tool = toolOf();

    const result = await tool.run(
      tool.input.parse({ duty: "plans", roleKey: key }),
      anOfficeToolCall("session-1"),
    );

    expect(result).toMatchObject({ isError: false });
    expect(result.text).toContain("Lea");
    const routed = await send("PUT", "/settings/duties/reviews", { roleKey: key });
    expect(routed.status).toBe(200);
    expect(dutySchema.parse(await routed.json())).toMatchObject({ key: "reviews", roleKey: key });
  });

  it("answers a Role not hired in words, as the route answers 422, and changes nothing", async () => {
    const tool = toolOf();

    const result = await tool.run(
      tool.input.parse({ duty: "plans", roleKey: "nobody" }),
      anOfficeToolCall("session-1"),
    );
    const routed = await send("PUT", "/settings/duties/plans", { roleKey: "nobody" });

    expect(result).toMatchObject({ isError: true });
    expect(routed.status).toBe(422);
    expect(roleRefusalSchema.parse(await routed.json()).reasons).toEqual([result.text]);
  });

  it("says a duty with no holder has none", async () => {
    const tool = toolOf();

    const result = await tool.run(
      tool.input.parse({ duty: "plans", roleKey: null }),
      anOfficeToolCall("session-1"),
    );

    expect(result).toMatchObject({ isError: false, text: "Plans has no holder now." });
  });

  it("drafts the holder beside the one now, applies it and then reads stale", async () => {
    const { key } = await hireOwn("Quin");
    const tool = toolOf();
    const input = tool.input.parse({ duty: "plans", roleKey: key });

    const draft = await tool.draft?.(input);

    expect(draft?.subject).toMatchObject({ kind: "office-setting", id: "duty:plans" });
    expect(draft?.subject.title).toBe("Plans");
    expect(draft?.fields).toMatchObject([
      { label: "Duty", after: "plans" },
      { label: "Role key", before: "planner", after: key },
    ]);
    const applied = await tool.applyFor?.(input, {
      user: { userId: "user-ann", name: "Ann Lee" },
      proposedBy: "cto",
    });
    expect(applied).toMatchObject({ isError: false });
    const listed = await (await send("GET", "/settings/duties")).json();
    expect(
      (listed as { key: string; roleKey: string }[]).find((d) => d.key === "plans"),
    ).toMatchObject({ roleKey: key });
    expect((await tool.draft?.(input))?.fingerprint).not.toEqual(draft?.fingerprint);
  });
});
