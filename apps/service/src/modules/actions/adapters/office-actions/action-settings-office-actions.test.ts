import type { INestApplication } from "@nestjs/common";
import { SET_ACTION_SETTINGS_ACTION } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
import { ActionLimits } from "../../application/action-limits.js";
import { ActionSettingsForTests } from "../../ports/actions-ports.fixtures.js";
import { ActionSettingsStore } from "../../ports/action-settings-store.js";
import { ActionSettingsOfficeActionsController } from "../http/action-settings-office-actions.controller.js";
import { ActionSettingsController } from "../http/action-settings.controller.js";
import { ActionSettingsOfficeActions } from "./action-settings-office-actions.js";

const USER = { userId: "user-ann", name: "Ann Lee" };

let app: INestApplication;
let url: string;
let settings: ActionSettingsForTests;
let tool: OfficeTool;

beforeEach(async () => {
  settings = new ActionSettingsForTests();
  ({ app, url } = await startTestApplication({
    controllers: [ActionSettingsController, ActionSettingsOfficeActionsController],
    providers: [
      { provide: ActionSettingsStore, useValue: settings },
      { provide: OfficeToolRegistry, useValue: new OfficeToolRegistry() },
      EventBus,
      ActionLimits,
      ActionSettingsOfficeActions,
    ],
  }));
  const [found] = app
    .get(OfficeToolRegistry)
    .named([SET_ACTION_SETTINGS_ACTION.name], RUN_EVERY_CALL);
  if (!found) throw new Error("set_action_settings is not registered.");
  tool = found;
});

afterEach(async () => {
  await app.close();
});

function put(body: unknown): Promise<Response> {
  return fetch(`${url}/api/settings/actions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("set_action_settings through its route", () => {
  it("keeps Actions at once and answers the setting saved", async () => {
    const response = await put({ actionsAtOnce: 4 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actionsAtOnce: 4 });
    expect(settings.settings).toEqual({ actionsAtOnce: 4 });
  });

  it("refuses a value out of its bounds, 400 naming the field", async () => {
    const response = await put({ actionsAtOnce: 7 });

    expect(response.status).toBe(400);
    expect(settings.settings.actionsAtOnce).toBe(2);
  });
});

describe("set_action_settings as an Office tool", () => {
  it("is in the group of its declaration", () => {
    expect(tool.authority?.group).toBe(SET_ACTION_SETTINGS_ACTION.group);
  });

  it("saves the setting for a person, in words", async () => {
    const result = await tool.run(
      tool.input.parse({ actionsAtOnce: 5 }),
      anOfficeToolCall("session-1"),
    );

    expect(result.isError).toBe(false);
    expect(result.text).toContain("5 at once");
    expect(settings.settings).toEqual({ actionsAtOnce: 5 });
  });

  it("drafts the number beside the one in force, applies it and then reads stale", async () => {
    const draft = await tool.draft?.(tool.input.parse({ actionsAtOnce: 5 }));

    expect(draft?.subject).toMatchObject({ kind: "office-setting", id: "actions" });
    expect(draft?.subject.title).toBe("Actions at once");
    expect(draft?.fields).toMatchObject([{ before: "2", after: "5" }]);
    const applied = await tool.applyFor?.(tool.input.parse({ actionsAtOnce: 5 }), {
      user: USER,
      proposedBy: "developer",
    });
    expect(applied?.isError).toBe(false);
    expect(settings.settings).toEqual({ actionsAtOnce: 5 });
    const after = await tool.draft?.(tool.input.parse({ actionsAtOnce: 5 }));
    expect(after?.fingerprint).not.toEqual(draft?.fingerprint);
  });
});
