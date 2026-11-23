import { describe, expect, it } from "vitest";
import { FIRST_CLAUDE_CODE_ENGINE, type EngineModels } from "../../engine/index.js";
import type { ProjectMcpServerValues, ProjectServerValues } from "../../mcp-servers/index.js";
import type { EnvironmentCheck } from "../domain/environment-check.js";
import { aProject } from "../domain/project.fixtures.js";
import type { Project } from "../domain/project.js";
import type { TestTarget } from "../domain/test-target.js";
import type { Action } from "../domain/action.js";
import type { ActionRepository } from "../ports/action-repository.js";
import type { TestTargetRepository } from "../ports/test-target-repository.js";
import type { BaseCheckouts } from "./base-checkouts.js";
import type { EnvironmentChecks } from "./environment-checks.js";
import type { ProjectService } from "./project-service.js";
import { ProjectDeviceLines, type ProjectDeviceLine } from "./project-device-lines.js";
import { ProjectRecords } from "./project-records.js";

interface Surroundings {
  readonly checks?: Readonly<Record<string, EnvironmentCheck>>;
  readonly serverValues?: Readonly<Record<string, readonly ProjectMcpServerValues[]>>;
  readonly testTargets?: Readonly<Record<string, readonly TestTarget[]>>;
  readonly actions?: Readonly<Record<string, readonly Action[]>>;
  readonly devices?: Readonly<Record<string, readonly ProjectDeviceLine[]>>;
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
  const testTargets: Pick<TestTargetRepository, "listOf"> = {
    listOf: (id) => Promise.resolve(surroundings.testTargets?.[id] ?? []),
  };
  const actions: Pick<ActionRepository, "listOf"> = {
    listOf: (id) => Promise.resolve(surroundings.actions?.[id] ?? []),
  };
  const devices = new ProjectDeviceLines();
  devices.register((id) => Promise.resolve(surroundings.devices?.[id] ?? []));
  const engines: Pick<EngineModels, "engines"> = {
    engines: () =>
      Promise.resolve([{ ...FIRST_CLAUDE_CODE_ENGINE, id: "claude", name: "Ann's Claude" }]),
  };
  return new ProjectRecords(
    service as ProjectService,
    bases as BaseCheckouts,
    checks as EnvironmentChecks,
    serverValues as ProjectServerValues,
    testTargets as TestTargetRepository,
    actions as ActionRepository,
    devices,
    engines as EngineModels,
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
        "- Delete branches once merged: off",
        "- Default Pipeline: full",
        "- Project limit: 1 Task started at once",
        "- Run environment: not decided yet",
        "- Features: Connected devices off (needs Run environment), Test targets on, GitHub issues on, Run environment off, Actions on",
        "- Variables to set: none",
        "- Secret variables (values never shown): none",
        "- Variables to remove: none",
        "- Folders in front of PATH: none",
        "- Environment check: never run",
        "- Default engine: the Office's default",
        "- Forced model and effort: none",
        "- Model and effort per person: none",
        "- Project skills: used",
        "- Server values: none",
        "- Test targets: none",
        "- Actions: none",
        "- Devices: none",
      ].join("\n"),
    );
  });

  it("names each Secret variable and secret Server value without its value", async () => {
    const project = aProject({
      repositoryUrl: "https://github.com/acme/admin-panel.git",
      projectLimit: 2,
      runEnvironment: "on",
      features: { "github-issues": false },
      environment: {
        set: [
          { name: "JAVA_HOME", value: "/opt/java-21", secret: false },
          { name: "NPM_TOKEN", value: "npm_s3cret", secret: true },
        ],
        unset: ["CI"],
        prependPath: ["/opt/tools"],
      },
      engine: {
        default: { engineType: "claude-code", engineId: "claude" },
        force: { model: "claude-sonnet-5-5", effort: null },
        people: [
          {
            roleKey: "cto",
            engineSettings: {
              "claude-code": { model: "claude-opus-5-5", effort: "high" },
              codex: { model: null, effort: "low" },
            },
          },
          { roleKey: "reviewer", engineSettings: { codex: { model: "gpt-5.5", effort: null } } },
        ],
      },
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
        "- Features: Connected devices on, Test targets on, GitHub issues off, Run environment on, Actions on",
        "- Variables to set: `JAVA_HOME=/opt/java-21`",
        "- Secret variables (values never shown): NPM_TOKEN (value set)",
        "- Variables to remove: CI",
        "- Folders in front of PATH: /opt/tools",
        "- Environment check: failed, 2026-11-19T08:05:00.000Z; failed: test",
        "- Default engine: Claude Code, account Ann's Claude",
        "- Forced model and effort: Claude Code: claude-sonnet-5-5 · Engine's default",
        "- Model and effort per person: cto: Claude Code claude-opus-5-5 · high, Codex Person's setting · low; reviewer: Codex gpt-5.5 · Person's setting",
        "- Project skills: used, but off: deploy",
        "- Server values: sentry TOKEN: the Project's own secret value, sentry ORG: the Office-wide value, sentry REGION: the Project's own `eu`",
      ]),
    );
  });

  it("gives each test target with who set each value, its Secret variables by name alone", async () => {
    const ann = { by: "user", user: { userId: "user-ann", name: "Ann" } } as const;
    const devops = {
      by: "proposal",
      proposalId: "proposal-1",
      agent: { roleKey: "devops", name: "Dana" },
    } as const;
    const records = recordsOver([aProject()], {
      testTargets: {
        "admin-panel": [
          {
            key: "web",
            name: "Web app",
            kind: "hosted",
            entryPoint: {
              kind: "package-script",
              manifest: "package.json",
              script: "start",
              arguments: [],
            },
            port: 3000,
            portVariable: "WEB_PORT",
            variables: [{ name: "MODE", value: "test" }],
            secretVariables: [
              { name: "API_KEY", value: "api-s3cret" },
              { name: "MAPS_KEY", value: null },
            ],
            commandsBefore: ["build", "seed"],
            memoryMegabytes: 2048,
            setBy: {
              name: ann,
              kind: devops,
              entryPoint: devops,
              port: ann,
              variables: devops,
              commandsBefore: devops,
              memoryMegabytes: ann,
            },
          },
          {
            key: "android",
            name: "Android",
            kind: "build-to-install",
            entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: [] },
            outputPatterns: ["app/build/outputs/apk/debug/*.apk"],
            variables: [],
            secretVariables: [],
            commandsBefore: [],
            memoryMegabytes: null,
            setBy: {},
          },
        ],
      },
    });

    const record = (await records.of("admin-panel")) ?? "";

    expect(record).not.toContain("api-s3cret");
    expect(record.split("\n").slice(-5, -2)).toEqual([
      "- Test targets:",
      "  - web (Web app, Hosted): script start of package.json; port 3000 in `WEB_PORT`; variables `MODE=test`; Secret variables (values never shown) API_KEY (value set), MAPS_KEY (no value); commands before the entry point build, seed; memory per service 2 GB; set by: name the user Ann, kind a Proposal by Dana (devops), entry point a Proposal by Dana (devops), port the user Ann, variables a Proposal by Dana (devops), Secret variables unknown, commands before the entry point a Proposal by Dana (devops), port variable unknown, memory per service the user Ann",
      "  - android (Android, Build to install): Gradle task assembleDebug; output files app/build/outputs/apk/debug/*.apk; variables none; Secret variables (values never shown) none; commands before the entry point none; memory per service the Office-wide value; set by: name unknown, kind unknown, entry point unknown, output files unknown, variables unknown, Secret variables unknown, commands before the entry point unknown, memory per service unknown",
    ]);
  });

  it("gives each Action with its kind's settings, whether it leaves the workstation and who set each value", async () => {
    const ann = { by: "user", user: { userId: "user-ann", name: "Ann" } } as const;
    const devops = {
      by: "proposal",
      proposalId: "proposal-2",
      agent: { roleKey: "devops", name: "Dana" },
    } as const;
    const records = recordsOver([aProject()], {
      actions: {
        "admin-panel": [
          {
            key: "build-web",
            name: "Build web",
            kind: "project-command",
            settings: { commandKey: "build", commandsBefore: ["install"], timeLimitMinutes: null },
            leavesTheWorkstation: false,
            setBy: { name: ann, kind: ann, settings: ann, leavesTheWorkstation: ann },
          },
          {
            key: "phone",
            name: "Install on my phone",
            kind: "test-target",
            settings: { targetKey: "android" },
            leavesTheWorkstation: false,
            setBy: {},
          },
          {
            key: "release",
            name: "Release",
            kind: "workflow",
            settings: { file: "release.yml", inputs: { channel: "stable" } },
            leavesTheWorkstation: true,
            setBy: { name: devops, kind: devops, settings: devops, leavesTheWorkstation: devops },
          },
        ],
      },
    });

    const record = (await records.of("admin-panel")) ?? "";

    expect(record.split("\n").slice(-5, -1)).toEqual([
      "- Actions:",
      "  - build-web (Build web, Project command): command build; commands before it install; time limit the default 60 minutes; stays on the workstation; set by: name the user Ann, kind the user Ann, settings the user Ann, leaves the workstation the user Ann",
      "  - phone (Install on my phone, Test target): test target android; stays on the workstation; set by: name unknown, kind unknown, settings unknown, leaves the workstation unknown",
      "  - release (Release, Workflow): Workflow release.yml; inputs `channel=stable`; leaves the workstation; set by: name a Proposal by Dana (devops), kind a Proposal by Dana (devops), settings a Proposal by Dana (devops), leaves the workstation a Proposal by Dana (devops)",
    ]);
  });

  it("lists each device by id, name, kind and state, never its address", async () => {
    const records = recordsOver([aProject()], {
      devices: {
        "admin-panel": [
          {
            id: "device-1",
            kind: "Android phone over wireless debugging",
            name: "Pixel 9",
            state: "In use by Install on the phone",
          },
          { id: "device-2", kind: "Serial board over USB", name: "Arduino Uno", state: "Over USB" },
        ],
      },
    });

    const record = (await records.of("admin-panel")) ?? "";

    expect(record.split("\n").slice(-3)).toEqual([
      "- Devices:",
      "  - device-1 (Pixel 9, Android phone over wireless debugging): In use by Install on the phone",
      "  - device-2 (Arduino Uno, Serial board over USB): Over USB",
    ]);
  });

  it("leaves out a device lister that fails, logging it", async () => {
    const lines = new ProjectDeviceLines();
    lines.register(() => Promise.reject(new Error("The database is down.")));
    lines.register(() =>
      Promise.resolve([
        { id: "device-1", kind: "Serial board over USB", name: "Uno", state: "Over USB" },
      ]),
    );

    expect(await lines.of("admin-panel")).toEqual([
      { id: "device-1", kind: "Serial board over USB", name: "Uno", state: "Over USB" },
    ]);
  });

  it("is undefined for a Project The Office doesn't have", async () => {
    expect(await recordsOver([]).of("gone")).toBeUndefined();
  });
});
