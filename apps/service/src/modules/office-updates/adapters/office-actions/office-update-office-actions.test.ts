import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  CANCEL_OFFICE_RESTART_ACTION,
  CANCEL_OFFICE_UPDATE_ACTION,
  CHECK_FOR_UPDATES_ACTION,
  OFFICE_UPDATE_OFFICE_ACTIONS,
  SCHEDULE_OFFICE_RESTART_ACTION,
  SCHEDULE_OFFICE_UPDATE_ACTION,
  officeUpdateSchema,
  type OfficeAction,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { BusyWork } from "../../../busy-work/index.js";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import {
  EngineModule,
  OfficeToolRegistry,
  ScriptedEngine,
  ScriptedEngineModule,
  type OfficeToolRuling,
} from "../../../engine/index.js";
import { OfficeUpdatesModule } from "../../office-updates.module.js";
import { updateSystem } from "../../ports/update-system.fixtures.js";
import {
  createOfficeCheckout,
  type OfficeCheckoutForTests,
} from "../git/office-checkout.fixtures.js";

let folder: string;
let checkout: OfficeCheckoutForTests;
let app: INestApplication;
let url: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-update-actions-"));
  checkout = await createOfficeCheckout(join(folder, "office"));
  const updateFolder = join(folder, "update");
  await mkdir(updateFolder);
  ({ app, url } = await startTestApplication({
    database: true,
    moduleOverrides: [
      { module: EngineModule, useModule: ScriptedEngineModule.register(new ScriptedEngine([])) },
    ],
    imports: [
      EventsModule,
      TelemetryModule,
      EventStreamModule,
      OfficeUpdatesModule.register({ checkout: checkout.path, updateFolder }),
    ],
    overrides: [updateSystem()],
  }));
});

afterEach(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

function runTool(action: OfficeAction) {
  const [tool] = app.get(OfficeToolRegistry).named([action.name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`${action.name} is not registered.`);
  return tool.run(tool.input.parse({}), anOfficeToolCall("session-1"));
}

const WAITS_ON_THE_USER = "The call waits on the user's approval.";

/** The ruling of a person whose Updates and restarts row is Ask me: their calls wait on the user. */
const ASK_ME_FOR_UPDATES: OfficeToolRuling = {
  rule: (_call, { authority }) =>
    Promise.resolve(
      authority?.group === "updatesAndRestarts"
        ? { kind: "hold", words: WAITS_ON_THE_USER }
        : { kind: "run" },
    ),
};

async function scheduled() {
  const answer = officeUpdateSchema.parse(await (await fetch(`${url}/api/office-update`)).json());
  return answer.scheduled;
}

describe("the Office actions of updates and restarts", () => {
  it("registers a tool for each, ruled by the Updates and restarts row, save the check", () => {
    const tools = app.get(OfficeToolRegistry).named(
      OFFICE_UPDATE_OFFICE_ACTIONS.map(({ name }) => name),
      RUN_EVERY_CALL,
    );

    expect(tools.map(({ name }) => name)).toEqual(
      OFFICE_UPDATE_OFFICE_ACTIONS.map(({ name }) => name),
    );
    expect(
      Object.fromEntries(tools.map(({ name, authority }) => [name, authority?.group])),
    ).toMatchObject({
      check_for_updates: "checks",
      schedule_office_update: "updatesAndRestarts",
      cancel_office_update: "updatesAndRestarts",
      schedule_office_restart: "updatesAndRestarts",
      cancel_office_restart: "updatesAndRestarts",
    });
  });

  it("checks for updates through its tool, saying what it found", async () => {
    const result = await runTool(CHECK_FOR_UPDATES_ACTION);

    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/^Checked for updates/);
  });

  it("schedules a restart through its tool and cancels it, the work it waits for held meanwhile", async () => {
    const endBusy = app.get(BusyWork).begin({ kind: "clone", label: "The clone of a repository" });

    const scheduling = await runTool(SCHEDULE_OFFICE_RESTART_ACTION);
    const held = await scheduled();
    const cancelling = await runTool(CANCEL_OFFICE_RESTART_ACTION);
    endBusy();

    expect(scheduling).toEqual({
      text: expect.stringContaining("restart is scheduled") as unknown,
      isError: false,
    });
    expect(held).toMatchObject({ kind: "restart", busy: [{ kind: "clone" }] });
    expect(cancelling.isError).toBe(false);
    expect(await scheduled()).toBeUndefined();
  });

  it("holds a schedule ruled Ask me, scheduling nothing, with the restart named on the card", async () => {
    const registry = app.get(OfficeToolRegistry);
    const [tool] = registry.named([SCHEDULE_OFFICE_RESTART_ACTION.name], ASK_ME_FOR_UPDATES);
    if (!tool) throw new Error("schedule_office_restart is not registered.");

    const held = await tool.run(tool.input.parse({}), anOfficeToolCall("session-1"));
    const card = await registry.draft(SCHEDULE_OFFICE_RESTART_ACTION.name, {});

    expect(held).toEqual({ text: WAITS_ON_THE_USER, isError: true });
    expect(await scheduled()).toBeUndefined();
    expect(card?.subject).toMatchObject({ title: "The Office restart" });
  });

  it("answers a refused schedule or cancel in its reasons, as an error", async () => {
    const noUpdate = await runTool(SCHEDULE_OFFICE_UPDATE_ACTION);
    const nothingScheduled = await runTool(CANCEL_OFFICE_UPDATE_ACTION);

    expect(noUpdate.isError).toBe(true);
    expect(noUpdate.text).not.toBe("");
    expect(nothingScheduled.isError).toBe(true);
  });

  it("keeps the routes' 204 for a schedule and a cancel", async () => {
    const endBusy = app.get(BusyWork).begin({ kind: "clone", label: "The clone of a repository" });
    const schedule = await fetch(`${url}/api/office-restart/schedule`, { method: "POST" });
    const cancel = await fetch(`${url}/api/office-restart/schedule`, { method: "DELETE" });
    endBusy();

    expect([schedule.status, cancel.status]).toEqual([204, 204]);
  });
});
