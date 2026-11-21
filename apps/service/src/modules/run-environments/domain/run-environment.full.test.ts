import { describe, expect, it } from "vitest";
import type { RunEnvironmentDefinition } from "./run-environment-definition.js";
import {
  commandScript,
  commandVariables,
  composeOverrideOf,
  composeProjectNameOf,
  cpuLimitProblemOf,
  handBackScript,
  type CpuLimit,
  type RunEnvironmentLimits,
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
  repositoryGitFolder: "/data/repositories/shop/.git",
  stageRunsFolder: "/data/stage-runs/6d4250e7",
  installCommand: "npm ci",
  installInputs: ["package-lock.json"],
  installVariables: [],
};

const DEVICE_HELPER_FOLDER = "/data/device-helper";

const DEVICE_HELPER_MOUNT = {
  type: "bind",
  source: DEVICE_HELPER_FOLDER,
  target: "/office-device-helper",
  read_only: true,
};

const STAGE_RUNS_MOUNT = {
  type: "bind",
  source: TASK.stageRunsFolder,
  target: TASK.stageRunsFolder,
  read_only: true,
};

const AUTOMATIC: CpuLimit = { choice: "automatic", fixedCpus: 2 };
const LIMITS: RunEnvironmentLimits = {
  cpuLimit: AUTOMATIC,
  memoryMegabytes: 4096,
  processes: 1024,
};
const HOST_CORES = 10;

function overrideWith(limits: RunEnvironmentLimits, hostCores: number): Record<string, unknown> {
  return composeOverrideOf(
    DEFINITION,
    TASK,
    "the-office/shop:key",
    "abc",
    limits,
    hostCores,
    DEVICE_HELPER_FOLDER,
  );
}

const LABELS = {
  "office.managed": "true",
  "office.instance": "abc",
  "office.task": "6d4250e7",
  "office.project": "shop",
};

describe("composeOverrideOf", () => {
  const override = overrideWith(LIMITS, HOST_CORES);

  it("mounts the worktree at its own path in the checks' service, on the Project's image", () => {
    expect(override).toMatchObject({
      services: {
        app: {
          image: "the-office/shop:key",
          pull_policy: "never",
          working_dir: TASK.worktree,
        },
      },
    });
    expect(override).toHaveProperty("services.app.volumes.0", {
      type: "bind",
      source: TASK.worktree,
      target: TASK.worktree,
    });
    expect(override).not.toHaveProperty("services.postgres.volumes");
    expect(override).not.toHaveProperty("services.app.command");
  });

  it("mounts the repository's git folder read-only at its own path, where the worktree's .git file leads", () => {
    expect(override).toHaveProperty("services.app.volumes", [
      { type: "bind", source: TASK.worktree, target: TASK.worktree },
      {
        type: "bind",
        source: TASK.repositoryGitFolder,
        target: TASK.repositoryGitFolder,
        read_only: true,
      },
      STAGE_RUNS_MOUNT,
      DEVICE_HELPER_MOUNT,
    ]);
  });

  it("mounts the Task's Stage runs' folder read-only at its own path, never its file", () => {
    expect(override).toHaveProperty("services.app.volumes.2", STAGE_RUNS_MOUNT);
  });

  it("writes a `$` in the folders as compose reads one", () => {
    const task = {
      ...TASK,
      worktree: "/data/worktrees/$shop/6d4250e7",
      repositoryGitFolder: "/data/repositories/$shop/.git",
      stageRunsFolder: "/data/stage-runs/$6d4250e7",
    };

    expect(
      composeOverrideOf(
        DEFINITION,
        task,
        "the-office/shop:key",
        "abc",
        LIMITS,
        HOST_CORES,
        DEVICE_HELPER_FOLDER,
      ),
    ).toHaveProperty("services.app.volumes", [
      {
        type: "bind",
        source: "/data/worktrees/$$shop/6d4250e7",
        target: "/data/worktrees/$$shop/6d4250e7",
      },
      {
        type: "bind",
        source: "/data/repositories/$$shop/.git",
        target: "/data/repositories/$$shop/.git",
        read_only: true,
      },
      {
        type: "bind",
        source: "/data/stage-runs/$$6d4250e7",
        target: "/data/stage-runs/$$6d4250e7",
        read_only: true,
      },
      DEVICE_HELPER_MOUNT,
    ]);
  });

  it.each([
    { case: "inside the worktree, as a main checkout's is", folder: `${TASK.worktree}/.git` },
    { case: "the worktree itself", folder: TASK.worktree },
  ])("mounts no git folder of its own when it is $case", ({ folder }) => {
    const task = { ...TASK, repositoryGitFolder: folder };

    expect(
      composeOverrideOf(
        DEFINITION,
        task,
        "the-office/shop:key",
        "abc",
        LIMITS,
        HOST_CORES,
        DEVICE_HELPER_FOLDER,
      ),
    ).toHaveProperty("services.app.volumes", [
      { type: "bind", source: TASK.worktree, target: TASK.worktree },
      STAGE_RUNS_MOUNT,
      DEVICE_HELPER_MOUNT,
    ]);
  });

  it("mounts a git folder whose name only starts like the worktree's", () => {
    const task = { ...TASK, repositoryGitFolder: `${TASK.worktree}-git` };

    expect(
      composeOverrideOf(
        DEFINITION,
        task,
        "the-office/shop:key",
        "abc",
        LIMITS,
        HOST_CORES,
        DEVICE_HELPER_FOLDER,
      ),
    ).toHaveProperty("services.app.volumes.1.source", `${TASK.worktree}-git`);
  });

  it("labels every service, network and volume, the default network among them", () => {
    expect(override).toMatchObject({
      services: { app: { labels: LABELS }, postgres: { labels: LABELS } },
      networks: { default: { labels: LABELS }, backend: { labels: LABELS } },
      volumes: { data: { labels: LABELS } },
    });
  });

  it("limits memory, swap and processes on every service", () => {
    const limits = { mem_limit: "4096m", memswap_limit: "4096m", pids_limit: 1024 };

    expect(override).toMatchObject({ services: { app: limits, postgres: limits } });
  });

  it.each([
    { hostCores: 1, checks: 1, others: 1 },
    { hostCores: 2, checks: 1, others: 1 },
    { hostCores: 4, checks: 2, others: 2 },
    { hostCores: 10, checks: 8, others: 2 },
  ])(
    "gives Automatic's checks' service $checks CPUs and every other $others on $hostCores cores",
    ({ hostCores, checks, others }) => {
      expect(overrideWith(LIMITS, hostCores)).toMatchObject({
        services: { app: { cpus: checks }, postgres: { cpus: others } },
      });
    },
  );

  it("gives every service the fixed number when the CPU limit is Fixed", () => {
    const fixed = { ...LIMITS, cpuLimit: { choice: "fixed", fixedCpus: 3 } } as const;

    expect(overrideWith(fixed, HOST_CORES)).toMatchObject({
      services: { app: { cpus: 3 }, postgres: { cpus: 3 } },
    });
  });

  it("holds a fixed number saved on a bigger computer to this one's cores", () => {
    const fixed = { ...LIMITS, cpuLimit: { choice: "fixed", fixedCpus: 12 } } as const;

    expect(overrideWith(fixed, 4)).toMatchObject({
      services: { app: { cpus: 4 }, postgres: { cpus: 4 } },
    });
  });

  // An explicit 1024 would lower each container's cgroup v2 weight below the runtime's default.
  it("sets no service's CPU shares", () => {
    expect(override).not.toHaveProperty("services.app.cpu_shares");
    expect(override).not.toHaveProperty("services.postgres.cpu_shares");
  });

  it("keeps the checks' service running with a command of its own when overrideCommand says so", () => {
    const overridden = composeOverrideOf(
      { ...DEFINITION, overrideCommand: true },
      TASK,
      "the-office/shop:key",
      "abc",
      LIMITS,
      HOST_CORES,
      DEVICE_HELPER_FOLDER,
    );

    expect(overridden).toHaveProperty("services.app.entrypoint", ["/bin/sh", "-c"]);
    // Compose would read "$!" as a variable.
    expect(overridden).toHaveProperty("services.app.command", [
      "trap 'exit 0' TERM; while :; do sleep 3600 & wait $$!; done",
    ]);
  });
});

describe("cpuLimitProblemOf", () => {
  it.each([0.5, 11])("refuses a fixed %s CPUs on 10 cores", (fixedCpus) => {
    expect(cpuLimitProblemOf({ choice: "fixed", fixedCpus }, HOST_CORES)).toBe(
      "A fixed CPU limit is between 1 and this computer's 10 cores.",
    );
  });

  it.each([1, 10])("takes a fixed %s CPUs on 10 cores", (fixedCpus) => {
    expect(cpuLimitProblemOf({ choice: "fixed", fixedCpus }, HOST_CORES)).toBeUndefined();
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
        'export NODE_ENV="$OFFICE_VARIABLE_0"',
        "unset OFFICE_VARIABLE_0",
        `export PATH='/opt/a:/opt/b':"$PATH"`,
        "npm test",
      ].join("\n"),
    );
  });

  it("holds no variable's value: the runtime gives each under its carrier, by name", () => {
    const environment = {
      set: [
        { name: "NPM_TOKEN", value: "npm_s3cret" },
        { name: "CI", value: "1" },
      ],
      unset: [],
      prependPath: [],
    };

    expect(commandScript("npm test", "/w", environment)).not.toContain("npm_s3cret");
    expect(commandVariables(environment)).toEqual({
      OFFICE_VARIABLE_0: "npm_s3cret",
      OFFICE_VARIABLE_1: "1",
    });
  });

  const environment = {
    set: [{ name: "GIT_CONFIG_COUNT", value: "1" }],
    unset: [],
    prependPath: ["/opt/a"],
  };

  it("on a root Office, trusts no repository and writes the script as it always has", () => {
    expect(commandScript("npm test", "/w", environment, { trustRepositories: false })).toBe(
      [
        "cd '/w' || exit 125",
        'export GIT_CONFIG_COUNT="$OFFICE_VARIABLE_0"',
        "unset OFFICE_VARIABLE_0",
        `export PATH='/opt/a':"$PATH"`,
        "npm test",
      ].join("\n"),
    );
    expect(commandScript("npm test", "/w", environment)).toBe(
      commandScript("npm test", "/w", environment, { trustRepositories: false }),
    );
  });

  it("trusts every repository in git after the Project's environment, adding to its config", () => {
    expect(commandScript("npm test", "/w", environment, { trustRepositories: true })).toBe(
      [
        "cd '/w' || exit 125",
        'export GIT_CONFIG_COUNT="$OFFICE_VARIABLE_0"',
        "unset OFFICE_VARIABLE_0",
        `export PATH='/opt/a':"$PATH"`,
        "office_n=${GIT_CONFIG_COUNT:-0}",
        'export "GIT_CONFIG_KEY_$office_n=safe.directory" "GIT_CONFIG_VALUE_$office_n=*"',
        "export GIT_CONFIG_COUNT=$((office_n + 1))",
        "unset office_n",
        "npm test",
      ].join("\n"),
    );
  });
});

describe("handBackScript", () => {
  it("gives the files another user or group owns, symlinks themselves, to the owner by number", () => {
    expect(handBackScript(`/w/it's $HOME`, { userId: 1000, groupId: 1001 })).toBe(
      "if command -v find >/dev/null 2>&1; then " +
        `find '/w/it'\\''s $HOME' \\( ! -user 1000 -o ! -group 1001 \\) -exec chown -h 1000:1001 {} +; ` +
        `else chown -R -h 1000:1001 '/w/it'\\''s $HOME'; fi`,
    );
  });
});
