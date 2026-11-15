import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_GRAFANA_IMAGE, BundledGrafanaFailed } from "./bundled-grafana.js";
import {
  DockerComposeBundledGrafana,
  problemOf,
  READ_TIMEOUT_MS,
  runStateOf,
  STOP_TIMEOUT_MS,
  UP_TIMEOUT_MS,
  UP_WAIT_SECONDS,
  type DockerCall,
  type DockerOutcome,
} from "./docker-compose-bundled-grafana.js";

const SUCCEEDED: DockerOutcome = { exitCode: 0, stdout: "", errorTail: "" };

describe("DockerComposeBundledGrafana", () => {
  let folder: string;
  let calls: DockerCall[];
  let answer: (call: DockerCall) => DockerOutcome;
  let grafana: DockerComposeBundledGrafana;

  beforeEach(async () => {
    folder = join(await mkdtemp(join(tmpdir(), "bundled-grafana-")), "grafana");
    calls = [];
    answer = () => SUCCEEDED;
    grafana = new DockerComposeBundledGrafana(folder, (call) => {
      calls.push(call);
      return Promise.resolve(answer(call));
    });
  });

  afterEach(async () => {
    await rm(join(folder, ".."), { recursive: true, force: true });
  });

  const compose = () => [
    "compose",
    "--project-name",
    "the-office-grafana",
    "--file",
    join(folder, "compose.yaml"),
  ];

  it("starts its own project from its own file and folder, waiting for health", async () => {
    await grafana.start();

    expect(calls).toEqual([
      {
        arguments: [
          ...compose(),
          "up",
          "--detach",
          "--wait",
          "--wait-timeout",
          String(UP_WAIT_SECONDS),
        ],
        workingFolder: folder,
        timeoutMs: UP_TIMEOUT_MS,
      },
    ]);
    expect(UP_TIMEOUT_MS).toBeGreaterThan(UP_WAIT_SECONDS * 1000);
  });

  it("writes a compose file on 127.0.0.1 alone, with a data volume, its own healthcheck and a restart policy", async () => {
    await grafana.start();
    const file = await readFile(join(folder, "compose.yaml"), "utf8");

    expect(file).toContain("name: the-office-grafana");
    expect(file).toContain(`image: ${BUNDLED_GRAFANA_IMAGE}`);
    expect(file).toContain('- "127.0.0.1:3300:3000"');
    expect(file).toContain('- "127.0.0.1:4317:4317"');
    expect(file).toContain('- "127.0.0.1:4318:4318"');
    expect(file).not.toMatch(/- "?(0\.0\.0\.0:)?\d+:\d+"?\n/);
    expect(file).toContain("- data:/data");
    expect(file).toContain('test: ["CMD", "/otel-lgtm/docker/healthcheck.sh"]');
    expect(file).toContain("start_period: 120s");
    expect(file).toContain("restart: unless-stopped");
  });

  it("answers absent with no Docker call while The Office never started it", async () => {
    expect(await grafana.state()).toBe("absent");
    await grafana.stop();

    expect(calls).toEqual([]);
  });

  it("reads its state with ps and stops it with stop once its file is written", async () => {
    await grafana.start();
    calls = [];
    answer = () => ({ ...SUCCEEDED, stdout: '{"State":"running","Health":"healthy"}\n' });

    expect(await grafana.state()).toBe("running");
    await grafana.stop();

    expect(calls).toEqual([
      {
        arguments: [...compose(), "ps", "--all", "--format", "json"],
        workingFolder: folder,
        timeoutMs: READ_TIMEOUT_MS,
      },
      { arguments: [...compose(), "stop"], workingFolder: folder, timeoutMs: STOP_TIMEOUT_MS },
    ]);
  });

  it("finds the earlier bundled Grafana by its Compose labels or its name, and stops it", async () => {
    answer = (call) => ({
      ...SUCCEEDED,
      stdout: call.arguments.some((argument) => argument.startsWith("name="))
        ? "the-office-grafana\n"
        : "the-office-otel-lgtm-1\n",
    });

    const earlier = await grafana.earlierContainers();
    await grafana.stopEarlier(earlier);

    expect(earlier).toEqual(["the-office-otel-lgtm-1", "the-office-grafana"]);
    expect(calls.map((call) => call.arguments)).toEqual([
      [
        "ps",
        "--filter",
        "label=com.docker.compose.project=the-office",
        "--filter",
        "label=com.docker.compose.service=otel-lgtm",
        "--format",
        "{{.Names}}",
      ],
      ["ps", "--filter", "name=^the-office-grafana$", "--format", "{{.Names}}"],
      ["stop", "the-office-otel-lgtm-1", "the-office-grafana"],
    ]);
  });

  it.each([
    [
      { exitCode: undefined, stdout: "", errorTail: "", ended: "not-started" },
      "docker-unreachable",
    ],
    [{ exitCode: undefined, stdout: "", errorTail: "", ended: "timeout" }, "not-healthy"],
    [
      {
        exitCode: 1,
        stdout: "",
        errorTail: "Bind for 127.0.0.1:4318 failed: port is already allocated",
      },
      "port-taken",
    ],
  ] as const)("turns a failed up into the card's problem (%j)", async (outcome, kind) => {
    answer = () => outcome;

    const failed = await grafana.start().catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(BundledGrafanaFailed);
    expect((failed as BundledGrafanaFailed).problem.kind).toBe(kind);
  });
});

describe("problemOf", () => {
  it.each([
    [
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
      "docker-unreachable",
    ],
    [
      "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock",
      "docker-unreachable",
    ],
    ["Error: listen tcp4 127.0.0.1:3300: bind: address already in use", "port-taken"],
    ["Error response from daemon: manifest unknown", "image-not-pulled"],
    ['failed to resolve reference "docker.io/grafana/otel-lgtm"', "image-not-pulled"],
    ["container the-office-grafana-otel-lgtm-1 is unhealthy", "not-healthy"],
  ])("reads %j as %s", (errorTail, kind) => {
    expect(problemOf(errorTail).kind).toBe(kind);
  });

  it("keeps the last line of anything else", () => {
    expect(problemOf("one\nsomething else broke\n")).toEqual({
      kind: "other",
      detail: "something else broke",
    });
  });
});

describe("runStateOf", () => {
  it.each([
    ["", "absent"],
    ['{"State":"exited","Health":""}', "stopped"],
    ['{"State":"running","Health":"starting"}', "starting"],
    ['{"State":"running","Health":"unhealthy"}', "unhealthy"],
    ['[{"State":"running","Health":"healthy"}]', "running"],
  ])("reads %j as %s", (listing, state) => {
    expect(runStateOf(listing)).toBe(state);
  });
});
