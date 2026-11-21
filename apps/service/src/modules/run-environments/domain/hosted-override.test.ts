import { stringify as stringifyYaml } from "yaml";
import { describe, expect, it } from "vitest";
import type { RunEnvironmentDefinition } from "./run-environment-definition.js";
import {
  entryPointCommandOf,
  hostedOverrideOf,
  hostedProjectNameOf,
  type HostedRun,
  type RunEnvironmentLimits,
} from "./run-environment.js";

const DEFINITION: RunEnvironmentDefinition = {
  composeFiles: [".devcontainer/compose.yaml"],
  service: "app",
  serviceImage: { kind: "image", image: "node:22" },
  services: ["app", "web", "postgres"],
  runServices: ["app", "web", "postgres"],
  networks: ["backend"],
  volumes: ["data"],
  overrideCommand: true,
};

const CHECKOUT = "/data/test-instances/2b1c/checkout";

const RUN: HostedRun = {
  testInstanceId: "2b1c",
  projectId: "shop",
  checkout: CHECKOUT,
  appService: "app",
  containerPort: 3000,
  variableNames: ["API_URL", "API_TOKEN"],
  portVariable: "PORT",
};

const LIMITS: RunEnvironmentLimits = {
  cpuLimit: { choice: "automatic", fixedCpus: 2 },
  memoryMegabytes: 4096,
  processes: 1024,
};

const LABELS = {
  "office.managed": "true",
  "office.instance": "abc",
  "office.test-instance": "2b1c",
  "office.project": "shop",
};

function overrideOf(run: HostedRun = RUN): Record<string, unknown> {
  const { value, problems } = hostedOverrideOf(
    DEFINITION,
    run,
    "the-office/shop:key",
    "abc",
    LIMITS,
    10,
  );
  expect(problems).toEqual([]);
  return value ?? {};
}

function portVariableProblemsOf(portVariable: string): readonly string[] {
  return hostedOverrideOf(
    DEFINITION,
    { ...RUN, portVariable },
    "the-office/shop:key",
    "abc",
    LIMITS,
    10,
  ).problems;
}

function servicesOf(override: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return override["services"] as Record<string, Record<string, unknown>>;
}

describe("hostedOverrideOf", () => {
  it("labels every service, network and volume with the instance and this Office", () => {
    const override = overrideOf();

    for (const service of Object.values(servicesOf(override))) {
      expect(service["labels"]).toEqual(LABELS);
    }
    expect(override["networks"]).toEqual({
      default: { labels: LABELS },
      backend: { labels: LABELS },
    });
    expect(override["volumes"]).toEqual({ data: { labels: LABELS } });
  });

  it("mounts the checkout alone, at its own path, in the devcontainer's service", () => {
    const services = servicesOf(overrideOf());

    expect(services["app"]).toMatchObject({
      image: "the-office/shop:key",
      pull_policy: "never",
      working_dir: CHECKOUT,
      volumes: [{ type: "bind", source: CHECKOUT, target: CHECKOUT }],
    });
    expect(services["web"]).not.toHaveProperty("volumes");
    expect(services["postgres"]).not.toHaveProperty("volumes");
  });

  it("publishes the app's port alone, on 127.0.0.1, in the devcontainer's service", () => {
    const services = servicesOf(overrideOf());

    expect(services["app"]?.["ports"]).toEqual(["127.0.0.1::3000"]);
    expect(services["web"]).not.toHaveProperty("ports");
    expect(services["postgres"]).not.toHaveProperty("ports");
  });

  it("publishes the port of the service a devcontainer-service entry point names, and only it", () => {
    const services = servicesOf(overrideOf({ ...RUN, appService: "web", containerPort: 8080 }));

    expect(services["web"]?.["ports"]).toEqual(["127.0.0.1::8080"]);
    expect(services["web"]?.["environment"]).toMatchObject({ API_URL: "${OFFICE_VARIABLE_0}" });
    expect(services["app"]).not.toHaveProperty("ports");
    expect(services["app"]).not.toHaveProperty("environment");
    // The checkout stays on the devcontainer's service, the only host folder.
    expect(services["app"]?.["volumes"]).toEqual([
      { type: "bind", source: CHECKOUT, target: CHECKOUT },
    ]);
  });

  it("gives the target's variables by their carriers, never their values, and marks the test instance", () => {
    const override = overrideOf();

    expect(servicesOf(override)["app"]?.["environment"]).toEqual({
      API_URL: "${OFFICE_VARIABLE_0}",
      API_TOKEN: "${OFFICE_VARIABLE_1}",
      OFFICE_TEST_INSTANCE: "true",
      PORT: "3000",
    });
    expect(stringifyYaml(override)).not.toMatch(/s3cret/);
  });

  it("limits every service as a Task's run environment is limited", () => {
    const services = servicesOf(overrideOf());

    expect(services["app"]).toMatchObject({ cpus: 8, mem_limit: "4096m", pids_limit: 1024 });
    expect(services["postgres"]).toMatchObject({
      cpus: 2,
      mem_limit: "4096m",
      memswap_limit: "4096m",
      pids_limit: 1024,
    });
  });

  it("sets the port variable to the container port in the app's service alone", () => {
    const services = servicesOf(
      overrideOf({ ...RUN, appService: "web", containerPort: 8080, portVariable: "SERVER_PORT" }),
    );

    expect(services["web"]?.["environment"]).toMatchObject({ SERVER_PORT: "8080" });
    expect(services["web"]?.["environment"]).not.toHaveProperty("PORT");
    expect(services["app"]).not.toHaveProperty("environment");
  });

  it("refuses a port variable that isn't a name, is the test instance's mark or is a target's variable", () => {
    expect(portVariableProblemsOf("9PORT")).toEqual([
      'The port variable "9PORT" isn\'t a variable name: use letters, digits and _, not starting with a digit.',
    ]);
    expect(portVariableProblemsOf("OFFICE_TEST_INSTANCE")).toEqual([
      "The port variable OFFICE_TEST_INSTANCE is one The Office sets itself.",
    ]);
    expect(portVariableProblemsOf("API_URL")).toEqual([
      "The port variable API_URL is also one of the target's variables.",
    ]);
  });

  it("puts the Memory per service it is given on every service, swap included", () => {
    const { value } = hostedOverrideOf(
      DEFINITION,
      RUN,
      "the-office/shop:key",
      "abc",
      { ...LIMITS, memoryMegabytes: 1536 },
      10,
    );

    for (const service of Object.values(servicesOf(value ?? {}))) {
      expect(service).toMatchObject({ mem_limit: "1536m", memswap_limit: "1536m" });
    }
  });

  it("writes a checkout path with $ as compose reads it literally", () => {
    const checkout = "/data/te$t";
    const services = servicesOf(overrideOf({ ...RUN, checkout }));

    expect(services["app"]).toMatchObject({
      working_dir: "/data/te$$t",
      volumes: [{ type: "bind", source: "/data/te$$t", target: "/data/te$$t" }],
    });
  });

  it("refuses a service not in the definition, a port out of range and a name that isn't one", () => {
    const { value, problems } = hostedOverrideOf(
      DEFINITION,
      { ...RUN, appService: "worker", containerPort: 70_000, variableNames: ["A=B"] },
      "the-office/shop:key",
      "abc",
      LIMITS,
      10,
    );

    expect(value).toBeUndefined();
    expect(problems).toEqual([
      "The service worker the entry point names isn't in the run environment definition.",
      "The port 70000 isn't a port from 1 to 65535.",
      'The variable name "A=B" isn\'t one: use letters, digits and _, not starting with a digit.',
    ]);
  });
});

describe("hostedProjectNameOf", () => {
  it("names the instance's compose project apart from every Task's", () => {
    expect(hostedProjectNameOf("abc", "2B1C")).toBe("office-abc-test-2b1c");
  });
});

describe("entryPointCommandOf", () => {
  it("runs a repository file from the checkout, its arguments one by one", () => {
    expect(
      entryPointCommandOf(
        {
          kind: "repository-file",
          path: "scripts/start.sh",
          arguments: ["--port", "3000; rm -rf /"],
        },
        CHECKOUT,
      ),
    ).toEqual({
      command: { folder: CHECKOUT, argv: ["./scripts/start.sh", "--port", "3000; rm -rf /"] },
    });
  });

  it("runs a package script in its manifest's folder, and a Gradle task through the wrapper", () => {
    expect(
      entryPointCommandOf(
        {
          kind: "package-script",
          manifest: "apps/web/package.json",
          script: "dev",
          arguments: ["--host"],
        },
        CHECKOUT,
      ),
    ).toEqual({
      command: { folder: `${CHECKOUT}/apps/web`, argv: ["npm", "run", "dev", "--", "--host"] },
    });
    expect(
      entryPointCommandOf({ kind: "gradle-task", task: "bootRun", arguments: [] }, CHECKOUT),
    ).toEqual({ command: { folder: CHECKOUT, argv: ["./gradlew", "bootRun"] } });
  });

  it("refuses a path that leads out of the checkout", () => {
    expect(
      entryPointCommandOf(
        { kind: "repository-file", path: "../outside.sh", arguments: [] },
        CHECKOUT,
      ),
    ).toEqual({ problem: "The entry point ../outside.sh isn't a file in the repository." });
    expect(
      entryPointCommandOf(
        { kind: "package-script", manifest: "/etc/package.json", script: "x", arguments: [] },
        CHECKOUT,
      ),
    ).toEqual({ problem: "The manifest /etc/package.json isn't a file in the repository." });
  });
});
