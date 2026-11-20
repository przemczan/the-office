import { describe, expect, it } from "vitest";
import type { ProjectMcpServerValues, ProjectServerValues } from "../../mcp-servers/index.js";
import type { EnvironmentCheck } from "../domain/environment-check.js";
import { aProject } from "../domain/project.fixtures.js";
import type { Project } from "../domain/project.js";
import type { BaseCheckouts } from "./base-checkouts.js";
import type { EnvironmentChecks } from "./environment-checks.js";
import type { ProjectService } from "./project-service.js";
import { ProjectRecords } from "./project-records.js";

interface Surroundings {
  readonly checks?: Readonly<Record<string, EnvironmentCheck>>;
  readonly serverValues?: Readonly<Record<string, readonly ProjectMcpServerValues[]>>;
}

function recordsOver(projects: Project[], surroundings: Surroundings = {}): ProjectRecords {
  const service: Pick<ProjectService, "list" | "find"> = {
    list: () => Promise.resolve(projects),
    find: (id) => Promise.resolve(projects.find((project) => project.id === id)),
  };
  const bases: Pick<BaseCheckouts, "list"> = {
    list: () =>
      Promise.resolve(
        projects.map((project) => ({
          projectId: project.id,
          name: project.name,
          baseBranch: project.baseBranch,
          folder: `/office/bases/${project.id}`,
        })),
      ),
  };
  const checks: Pick<EnvironmentChecks, "latest"> = {
    latest: (id) => Promise.resolve(surroundings.checks?.[id]),
  };
  const serverValues: Pick<ProjectServerValues, "of"> = {
    of: (id) => Promise.resolve(surroundings.serverValues?.[id] ?? []),
  };
  return new ProjectRecords(
    service as ProjectService,
    bases as BaseCheckouts,
    checks as EnvironmentChecks,
    serverValues as ProjectServerValues,
  );
}

const A_FAILED_CHECK: EnvironmentCheck = {
  projectId: "admin-panel",
  environment: { set: [], unset: [], prependPath: [] },
  state: "failed",
  checks: [
    { step: "worktree", state: "passed" },
    { step: "install", state: "passed", commandLine: "npm ci" },
    {
      step: "command",
      key: "build",
      name: "Build",
      kind: "build",
      state: "passed",
      commandLine: "",
    },
    { step: "command", key: "test", name: "Test", kind: "test", state: "failed", commandLine: "" },
  ],
  startedAt: new Date("2026-11-19T08:00:00.000Z"),
  finishedAt: new Date("2026-11-19T08:05:00.000Z"),
};

describe("ProjectRecords.of", () => {
  it("gives the settings the Project's page shows, as list_projects does", async () => {
    const records = recordsOver([aProject(), aProject({ id: "shop", name: "Shop" })]);

    expect(await records.of("admin-panel")).toBe(
      [
        "Admin panel (id admin-panel)",
        "- Path: /work/admin-panel",
        "- Base branch: main, read-only in chats at /office/bases/admin-panel",
        "- Install: `npm ci`",
        "- Commands: build (Build, build) `npm run build`, lint (Lint, lint) `npm run lint`, test (Test, test) `npm test`",
        "- Install inputs: package-lock.json",
        "- Publishing: push and open a pull request",
        "- Before publishing: `none`",
        "- After publishing: `none`",
        "- Default Pipeline: full",
        "- Project limit: 1 Task started at once",
        "- Run environment: not decided yet",
        "- Variables to set: none",
        "- Secret variables (values never shown): none",
        "- Variables to remove: none",
        "- Folders in front of PATH: none",
        "- Environment check: never run",
        "- Project default engine: none, the Office default applies",
        "- Role overrides: none",
        "- Project skills: used",
        "- Server values: none",
      ].join("\n"),
    );
  });

  it("names each Secret variable and secret Server value without its value", async () => {
    const project = aProject({
      repositoryUrl: "https://github.com/acme/admin-panel.git",
      projectLimit: 2,
      runEnvironment: "on",
      environment: {
        set: [
          { name: "JAVA_HOME", value: "/opt/java-21", secret: false },
          { name: "NPM_TOKEN", value: "npm_s3cret", secret: true },
        ],
        unset: ["CI"],
        prependPath: ["/opt/tools"],
      },
      projectDefault: { engineId: "claude", model: "sonnet" },
      useForEveryRole: true,
      roleOverrides: [{ roleKey: "cto", engineId: "claude", model: "opus" }],
      projectSkillsOff: ["deploy"],
    });
    const records = recordsOver([project], {
      checks: { "admin-panel": A_FAILED_CHECK },
      serverValues: {
        "admin-panel": [
          {
            serverName: "sentry",
            serverValues: [
              {
                serverValue: { name: "TOKEN", secret: true, required: true },
                projectValue: "sentry-s3cret",
              },
              {
                serverValue: {
                  name: "ORG",
                  secret: false,
                  required: true,
                  officeWideValue: "acme",
                },
                projectValue: undefined,
              },
              {
                serverValue: { name: "REGION", secret: false, required: false },
                projectValue: "eu",
              },
            ],
          },
        ],
      },
    });

    const record = await records.everyone();

    expect(record).not.toContain("npm_s3cret");
    expect(record).not.toContain("sentry-s3cret");
    expect(record.split("\n")).toEqual(
      expect.arrayContaining([
        "- Path: /work/admin-panel, cloned from https://github.com/acme/admin-panel.git",
        "- Project limit: 2 Tasks started at once",
        "- Run environment: on",
        "- Variables to set: `JAVA_HOME=/opt/java-21`",
        "- Secret variables (values never shown): NPM_TOKEN (value set)",
        "- Variables to remove: CI",
        "- Folders in front of PATH: /opt/tools",
        "- Environment check: failed, 2026-11-19T08:05:00.000Z; failed: test",
        "- Project default engine: engine claude, model sonnet, used for every Role",
        "- Role overrides: cto on engine claude, model opus",
        "- Project skills: used, but off: deploy",
        "- Server values: sentry TOKEN: the Project's own secret value, sentry ORG: the Office-wide value, sentry REGION: the Project's own `eu`",
      ]),
    );
  });

  it("is undefined for a Project The Office doesn't have", async () => {
    expect(await recordsOver([]).of("gone")).toBeUndefined();
  });
});
