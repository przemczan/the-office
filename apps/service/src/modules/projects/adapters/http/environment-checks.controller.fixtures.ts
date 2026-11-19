import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  latestEnvironmentCheckSchema,
  projectSchema,
  type EnvironmentCheck,
  type NewProject,
  type Project,
  type ProjectEnvironment,
  type ProjectEnvironmentEdit,
} from "@the-office/contracts";
import { expect } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EnvironmentCheckFinished } from "../../domain/environment-check-events.js";
import type { TemporaryRepository } from "../git/temporary-repository.fixtures.js";

export const PASSES = `node -e "process.exit(0)"`;
export const FAILS = `node -e "process.exit(2)"`;
export const NEEDS_GREETING = `node -e "process.exit(process.env.GREETING === 'hello' ? 0 : 1)"`;
export const SLEEPS = `node -e "setTimeout(() => {}, 60000)"`;
export const GREETING: ProjectEnvironment = {
  set: [{ name: "GREETING", value: "hello", secret: false }],
  unset: [],
  prependPath: [],
};

/** The check's steps, a command's by its key, with their states, in order. */
export function states(check: EnvironmentCheck): [string, string][] {
  return check.checks.map((each) => [each.step === "command" ? each.key : each.step, each.state]);
}

/** A check runs git and five commands, which take a few seconds on Windows. */
export const CHECK_TIMEOUT = { timeout: 30_000 };

/** The requests the environment check routes' tests share, on whatever app `current` gives. */
export function environmentChecksHttp(
  current: () => {
    readonly app: INestApplication;
    readonly url: string;
    readonly repository: TemporaryRepository;
    readonly officeData: string;
  },
) {
  function send(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<Response> {
    return fetch(`${current().url}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  /** A Project of the test's own name, since every test file shares the database. */
  async function addProject(fields: Partial<NewProject> = {}): Promise<Project> {
    const newProject: NewProject = {
      name: `Checked ${randomUUID().slice(0, 8)}`,
      path: current().repository.path,
      baseBranch: "main",
      mark: { label: "CH", colour: "teal" },
      installCommand: PASSES,
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: PASSES },
        { key: "lint", name: "Lint", kind: "lint", commandLine: PASSES },
        { key: "test", name: "Test", kind: "test", commandLine: NEEDS_GREETING },
      ],
      installInputs: [],
      publishingMode: "push-and-pull-request",
      defaultPipeline: "full",
      ...fields,
    };
    const response = await send("POST", "/projects", newProject);
    expect(response.status).toBe(201);
    return projectSchema.parse(await response.json());
  }

  /** Saves the Project's environment as the Project page's Save does. */
  async function save(project: Project, environment: ProjectEnvironmentEdit): Promise<Response> {
    return send("PUT", `/projects/${project.id}/environment`, { environment });
  }

  /** Saves the environment, then starts a check of it and waits for it to finish. */
  async function checked(
    project: Project,
    environment: ProjectEnvironmentEdit = GREETING,
  ): Promise<EnvironmentCheck> {
    expect((await save(project, environment)).status).toBe(200);
    const finished = new Promise<void>((resolve) => {
      const unsubscribe = current()
        .app.get(EventBus)
        .subscribe(EnvironmentCheckFinished, (event) => {
          if (event.projectId !== project.id) return;
          unsubscribe();
          resolve();
        });
    });
    const response = await send("POST", `/projects/${project.id}/environment-check`);
    expect(response.status).toBe(202);
    await finished;
    return latest(project);
  }

  async function latest(project: Project): Promise<EnvironmentCheck> {
    const response = await send("GET", `/projects/${project.id}/environment-check`);
    const { check } = latestEnvironmentCheckSchema.parse(await response.json());
    if (!check) throw new Error(`No environment check for ${project.id}`);
    return check;
  }

  async function environmentOf(project: Project): Promise<ProjectEnvironment> {
    const response = await send("GET", `/projects/${project.id}`);
    return projectSchema.parse(await response.json()).environment;
  }

  async function throwawayWorktrees(project: Project): Promise<string[]> {
    const names = await readdir(join(current().officeData, "worktrees", project.id)).catch(
      () => [],
    );
    return names.filter((name) => name.startsWith("_"));
  }

  return { send, addProject, save, checked, latest, environmentOf, throwawayWorktrees };
}
