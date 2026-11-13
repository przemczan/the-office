import type { INestApplication } from "@nestjs/common";
import {
  GITHUB_APP_REGISTRATION_FAILED_PARAMETER,
  gitHubAppManifestFormSchema,
  OFFICE_IDENTITY_SETTINGS_PATH,
  type GitHubAppManifestForm,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { GitHubModule } from "../../github.module.js";
import { FakeGitHub } from "../../index.fixtures.js";
import { GitHubAppRepository } from "../../ports/github-app-repository.js";
import { GitHubAppForTests } from "../../ports/github-app-repository.fixtures.js";
import { GitHubSignInRepository } from "../../ports/github-sign-in-repository.js";
import { GitHubSignInForTests } from "../../ports/github-sign-in-repository.fixtures.js";

let github: FakeGitHub;
let app: INestApplication;
let url: string;
let apps: GitHubAppForTests;
let published: DomainEvent[];

beforeEach(async () => {
  github = await FakeGitHub.start();
  apps = new GitHubAppForTests();
  ({ app, url } = await startTestApplication({
    imports: [EventsModule, EventStreamModule, GitHubModule.register(github.urls)],
    overrides: [
      { provide: GitHubAppRepository, useValue: apps },
      { provide: GitHubSignInRepository, useValue: new GitHubSignInForTests() },
    ],
  }));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
  await github.close();
});

async function manifestForm(): Promise<GitHubAppManifestForm> {
  const response = await fetch(`${url}/api/github/app/manifest`);
  expect(response.status).toBe(200);
  return gitHubAppManifestFormSchema.parse(await response.json());
}

/** Posts the form as the browser does; returns where GitHub sends the browser back. */
async function postToGitHub({ action, manifest }: GitHubAppManifestForm): Promise<string> {
  const response = await fetch(action, {
    method: "POST",
    body: new URLSearchParams({ manifest }),
    redirect: "manual",
  });
  expect(response.status).toBe(302);
  return response.headers.get("location") ?? "";
}

/** Follows GitHub's redirect back to The Office; returns where The Office sends the browser. */
async function returnToOffice(location: string): Promise<URL> {
  const response = await fetch(location, { redirect: "manual" });
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location") ?? "", url);
}

function stateOf(form: GitHubAppManifestForm): string {
  return new URL(form.action).searchParams.get("state") ?? "";
}

function failureOf(landing: URL): string | null {
  expect(landing.pathname).toBe(OFFICE_IDENTITY_SETTINGS_PATH);
  return landing.searchParams.get(GITHUB_APP_REGISTRATION_FAILED_PARAMETER);
}

function conversions(): number {
  return github.requestsTo(`${new URL(github.urls.api).pathname}/app-manifests/`).length;
}

describe("/api/github/app", () => {
  it("gives a form posting the manifest to GitHub's new-App page, sending the browser back to this Office", async () => {
    const form = await manifestForm();

    const action = new URL(form.action);
    expect(`${action.origin}${action.pathname}`).toBe(`${github.urls.web}/settings/apps/new`);
    expect(stateOf(form)).toMatch(/^[\w-]{32}$/);
    expect(JSON.parse(form.manifest)).toEqual({
      url,
      redirect_url: `${url}/api/github/app/registered`,
      callback_urls: [`${url}/api/github/sign-in/callback`, `${url}/api/sign-in/github/callback`],
      request_oauth_on_install: false,
      description: expect.any(String),
      public: false,
      default_permissions: {
        metadata: "read",
        contents: "write",
        pull_requests: "write",
        workflows: "write",
      },
    });
    expect((await manifestForm()).action).not.toBe(form.action);
  });

  it("takes each state once", async () => {
    const backFromGitHub = await postToGitHub(await manifestForm());
    await returnToOffice(backFromGitHub);

    const again = await returnToOffice(backFromGitHub);

    expect(failureOf(again)).toContain("wasn't started from this Office");
    expect(conversions()).toBe(1);
  });

  it("says why when GitHub refuses the code, keeping nothing", async () => {
    const form = await manifestForm();

    const landing = await returnToOffice(
      `${url}/api/github/app/registered?code=unknown&state=${stateOf(form)}`,
    );

    expect(failureOf(landing)).toBe(
      "GitHub no longer knows this registration code: a code is used once, within an hour. Register the App again.",
    );
    expect(apps.app).toBeUndefined();
    expect(published).toEqual([]);
  });

  it("says why when GitHub sends the browser back without a code", async () => {
    const form = await manifestForm();

    const landing = await returnToOffice(`${url}/api/github/app/registered?state=${stateOf(form)}`);

    expect(failureOf(landing)).toBe("GitHub sent no registration code. Register the App again.");
    expect(conversions()).toBe(0);
  });
});
