import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { latestEnvironmentCheckSchema, projectRefusalSchema } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import {
  CHECK_TIMEOUT,
  environmentChecksHttp,
  FAILS,
  GREETING,
  NEEDS_GREETING,
  PASSES,
  SLEEPS,
  states,
} from "./environment-checks.controller.fixtures.js";
import { startProjectsApplication } from "../../projects.controller.fixtures.js";

// Real git and real commands, in the default shell of the system the tests run on.
let repository: TemporaryRepository;
let officeData: string;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

const { send, addProject, save, checked, latest, environmentOf, throwawayWorktrees } =
  environmentChecksHttp(() => ({ app, url, repository, officeData }));

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  officeData = join(repository.folder, "office-data");
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  await startApplication();
});

afterEach(async () => {
  await app.close();
});

async function startApplication(): Promise<void> {
  ({ app, url } = await startProjectsApplication(repository));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
}

describe("POST /api/projects/:id/environment-check", CHECK_TIMEOUT, () => {
  it("leaves the saved environment as it is when a check fails, and still runs the others", async () => {
    const project = await addProject({
      installCommand: PASSES,
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: PASSES },
        { key: "lint", name: "Lint", kind: "lint", commandLine: FAILS },
        { key: "test", name: "Test", kind: "test", commandLine: PASSES },
      ],
    });

    const check = await checked(project);

    expect(check.state).toBe("failed");
    expect(states(check)).toEqual([
      ["worktree", "passed"],
      ["install", "passed"],
      ["build", "passed"],
      ["lint", "failed"],
      ["test", "passed"],
    ]);
    expect(check.checks[3]).toMatchObject({ run: { outcome: "failed", exitCode: 2 } });
    await expect(environmentOf(project)).resolves.toEqual(GREETING);
  });

  it("skips the commands that aren't set and runs the others", async () => {
    const project = await addProject({
      installCommand: "",
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: "" },
        { key: "lint", name: "Lint", kind: "lint", commandLine: PASSES },
        { key: "test", name: "Test", kind: "test", commandLine: NEEDS_GREETING },
      ],
    });

    const check = await checked(project);

    expect(check.state).toBe("passed");
    expect(states(check)).toEqual([
      ["worktree", "passed"],
      ["install", "skipped"],
      ["build", "skipped"],
      ["lint", "passed"],
      ["test", "passed"],
    ]);
    expect(check.checks[1]).not.toHaveProperty("run");
  });

  it("skips the rest when the install fails", async () => {
    const project = await addProject({
      installCommand: FAILS,
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: PASSES },
        { key: "lint", name: "Lint", kind: "lint", commandLine: PASSES },
        { key: "test", name: "Test", kind: "test", commandLine: PASSES },
      ],
    });

    const check = await checked(project);

    expect(states(check)).toEqual([
      ["worktree", "passed"],
      ["install", "failed"],
      ["build", "skipped"],
      ["lint", "skipped"],
      ["test", "skipped"],
    ]);
  });

  it("says when the base branch tracks no remote branch and is used unfetched", async () => {
    gitIn(repository.path, "branch", "--quiet", "--force", "untracked-base", "main");
    const project = await addProject({ baseBranch: "untracked-base" });

    const check = await checked(project);

    expect(check.checks[0]).toEqual({
      step: "worktree",
      state: "passed",
      base: { commit: gitIn(repository.path, "rev-parse", "untracked-base") },
    });
  });

  it("says what the Office identity lacks when the fetch fails", async () => {
    // Nothing listens on port 1, and The Office trusts no key of 127.0.0.1.
    gitIn(repository.path, "remote", "add", "unreachable", "ssh://git@127.0.0.1:1/repo.git");
    gitIn(repository.path, "branch", "--quiet", "--force", "unreachable-base", "main");
    gitIn(repository.path, "config", "branch.unreachable-base.remote", "unreachable");
    gitIn(repository.path, "config", "branch.unreachable-base.merge", "refs/heads/main");
    const project = await addProject({ baseBranch: "unreachable-base" });

    try {
      const check = await checked(project);

      expect(check.checks[0]).toMatchObject({ step: "worktree", state: "failed" });
      expect(check.checks[0]).toHaveProperty(
        "problem",
        expect.stringMatching(
          /^The Office doesn't trust 127\.0\.0\.1's host key yet: confirm its fingerprint in Settings › Office identity\. git fetch failed/,
        ),
      );
    } finally {
      gitIn(repository.path, "remote", "remove", "unreachable");
    }
  });

  it("refuses a Secret variable left without a value when none is kept", async () => {
    const project = await addProject();

    const refused = await save(project, {
      set: [{ name: "NPM_TOKEN", secret: true }],
      unset: [],
      prependPath: [],
    });

    expect(refused.status).toBe(422);
    expect(projectRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Give the Secret variable NPM_TOKEN a value.",
    ]);
  });

  it("stops a running check when The Office shuts down, and keeps it as stopped", async () => {
    const project = await addProject({
      installCommand: PASSES,
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: PASSES },
        { key: "lint", name: "Lint", kind: "lint", commandLine: PASSES },
        { key: "test", name: "Test", kind: "test", commandLine: SLEEPS },
      ],
    });
    await send("POST", `/projects/${project.id}/environment-check`);
    await expect
      .poll(async () => (await latest(project)).checks[4]?.state, CHECK_TIMEOUT)
      .toBe("running");

    await app.close();
    await startApplication();

    const check = await latest(project);
    expect(check.state).toBe("stopped");
    expect(check.checks[4]).toMatchObject({ state: "failed", run: { outcome: "stopped" } });
    await expect(environmentOf(project)).resolves.toEqual({ set: [], unset: [], prependPath: [] });
    expect(await throwawayWorktrees(project)).toEqual([]);
  });
});

describe("GET /api/projects/:id/environment-check", () => {
  it("answers no check for a Project never checked, and 404 for one that doesn't exist", async () => {
    const project = await addProject();

    const response = await send("GET", `/projects/${project.id}/environment-check`);
    expect(latestEnvironmentCheckSchema.parse(await response.json())).toEqual({ check: null });
    const missing = await send("GET", "/projects/nowhere/environment-check");
    expect(missing.status).toBe(404);
  });
});
