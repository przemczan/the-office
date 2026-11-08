import { describe, expect, it } from "vitest";
import type { RunEnvironmentDefinition } from "./run-environment-definition.js";
import {
  commandScript,
  composeOverrideOf,
  composeProjectNameOf,
  type TaskInWorktree,
} from "./run-environment.js";

const DEFINITION: RunEnvironmentDefinition = {
  composeFiles: [".devcontainer/compose.yaml"],
  service: "app",
  serviceImage: { kind: "image", image: "node:22" },
  services: ["app", "postgres"],
  runServices: ["app", "postgres"],
  networks: ["backend"],
  volumes: ["data"],
  overrideCommand: false,
};

const TASK: TaskInWorktree = {
  taskId: "6d4250e7",
  taskTitle: "Add login",
  projectId: "shop",
  worktree: "/data/worktrees/shop/6d4250e7",
  installCommand: "npm ci",
  installInputs: ["package-lock.json"],
};

const LIMITS = { cpus: 2, memoryMegabytes: 4096, processes: 1024 };

const LABELS = {
  "office.managed": "true",
  "office.instance": "abc",
  "office.task": "6d4250e7",
  "office.project": "shop",
};

describe("composeOverrideOf", () => {
  const override = composeOverrideOf(DEFINITION, TASK, "the-office/shop:key", "abc", LIMITS);

  it("mounts the worktree at its own path in the checks' service, on the Project's image", () => {
    expect(override).toMatchObject({
      services: {
        app: {
          image: "the-office/shop:key",
          pull_policy: "never",
          volumes: [{ type: "bind", source: TASK.worktree, target: TASK.worktree }],
          working_dir: TASK.worktree,
        },
      },
    });
    expect(override).not.toHaveProperty("services.postgres.volumes");
    expect(override).not.toHaveProperty("services.app.command");
  });

  it("labels every service, network and volume, the default network among them", () => {
    expect(override).toMatchObject({
      services: { app: { labels: LABELS }, postgres: { labels: LABELS } },
      networks: { default: { labels: LABELS }, backend: { labels: LABELS } },
      volumes: { data: { labels: LABELS } },
    });
  });

  it("limits CPU, memory, swap and processes on every service", () => {
    const limits = { cpus: 2, mem_limit: "4096m", memswap_limit: "4096m", pids_limit: 1024 };

    expect(override).toMatchObject({ services: { app: limits, postgres: limits } });
  });

  it("keeps the checks' service running with a command of its own when overrideCommand says so", () => {
    const overridden = composeOverrideOf(
      { ...DEFINITION, overrideCommand: true },
      TASK,
      "the-office/shop:key",
      "abc",
      LIMITS,
    );

    expect(overridden).toHaveProperty("services.app.entrypoint", ["/bin/sh", "-c"]);
    // Compose would read "$!" as a variable.
    expect(overridden).toHaveProperty("services.app.command", [
      "trap 'exit 0' TERM; while :; do sleep 3600 & wait $$!; done",
    ]);
  });
});

describe("composeProjectNameOf", () => {
  it("names the compose project by the Office and the Task, as compose allows", () => {
    expect(composeProjectNameOf("abc", "6D4250E7.x")).toBe("office-abc-6d4250e7-x");
  });
});

describe("commandScript", () => {
  it("runs in the folder with the Project's environment applied, the command line last", () => {
    expect(
      commandScript("npm test", "/w/it's", {
        set: [{ name: "NODE_ENV", value: "test 'quoted'" }],
        unset: ["CI"],
        prependPath: ["/opt/a", "/opt/b"],
      }),
    ).toBe(
      [
        "cd '/w/it'\\''s' || exit 125",
        "unset 'CI'",
        "export NODE_ENV='test '\\''quoted'\\'''",
        `export PATH='/opt/a:/opt/b':"$PATH"`,
        "npm test",
      ].join("\n"),
    );
  });
});
