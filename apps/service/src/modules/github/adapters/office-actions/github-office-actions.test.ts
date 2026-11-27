import type { INestApplication } from "@nestjs/common";
import { CHECK_GITHUB_PERMISSIONS_ACTION, gitHubStateSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import {
  EngineModule,
  OfficeToolRegistry,
  ScriptedEngine,
  ScriptedEngineModule,
} from "../../../engine/index.js";
import { GitHubModule } from "../../github.module.js";
import { FakeGitHub } from "../../index.fixtures.js";
import { GitHubAppRepository } from "../../ports/github-app-repository.js";
import { GitHubAppForTests } from "../../ports/github-app-repository.fixtures.js";
import { GitHubSignInRepository } from "../../ports/github-sign-in-repository.js";
import { GitHubSignInForTests } from "../../ports/github-sign-in-repository.fixtures.js";

let github: FakeGitHub;
let app: INestApplication;
let url: string;
let signIns: GitHubSignInForTests;

beforeEach(async () => {
  github = await FakeGitHub.start();
  signIns = new GitHubSignInForTests();
  ({ app, url } = await startTestApplication({
    database: true,
    moduleOverrides: [
      { module: EngineModule, useModule: ScriptedEngineModule.register(new ScriptedEngine([])) },
    ],
    imports: [EventsModule, EventStreamModule, TelemetryModule, GitHubModule.register(github.urls)],
    overrides: [
      { provide: GitHubAppRepository, useValue: new GitHubAppForTests() },
      { provide: GitHubSignInRepository, useValue: signIns },
    ],
  }));
});

afterEach(async () => {
  await app.close();
  await github.close();
});

function runTool() {
  const [tool] = app
    .get(OfficeToolRegistry)
    .named([CHECK_GITHUB_PERMISSIONS_ACTION.name], RUN_EVERY_CALL);
  if (!tool) throw new Error("check_github_permissions is not registered.");
  return tool.run(tool.input.parse({}), anOfficeToolCall("session-1"));
}

describe("check_github_permissions", () => {
  it("answers the route with the state, 200, before the App is registered", async () => {
    const response = await fetch(`${url}/api/github/permissions/check`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(gitHubStateSchema.parse(await response.json())).toEqual({ status: "not-registered" });
  });

  it("tells the Agent, through its tool, that nothing is registered", async () => {
    const result = await runTool();

    expect(result.isError).toBe(false);
    expect(result.text).toContain("isn't registered");
  });
});
