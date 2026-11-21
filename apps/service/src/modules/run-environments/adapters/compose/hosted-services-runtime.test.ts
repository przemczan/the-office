import { chmod, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { EntryPoint } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { OutputMask } from "../../../projects/index.js";
import {
  runEnvironmentsTestbed,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "../../application/run-environments.fixtures.js";
import type { HostedServiceStart } from "../../application/hosted-services.js";
import {
  officeLabels,
  testInstanceLabels,
  type HostedEntryPoint,
  type RunEnvironmentOptions,
} from "../../domain/run-environment.js";
import { REAL_RUNTIME_TEST, realRuntimeMissing } from "./compose-command-line.fixtures.js";
import { ComposeCommandLine } from "./compose-command-line.js";

const OPTIONS: RunEnvironmentOptions = {
  limits: { cpuLimit: { choice: "fixed", fixedCpus: 1 }, memoryMegabytes: 256, processes: 128 },
  runEnvironmentsAtOnce: 1,
};

/** The devcontainer's service, where the entry point serves, and a service with a named volume. */
const DEFINITION = {
  ".devcontainer/devcontainer.json": `{
    "dockerComposeFile": "compose.yaml",
    "service": "app",
    "overrideCommand": true
  }`,
  ".devcontainer/compose.yaml": `
services:
  app:
    image: busybox:1.37.0
  store:
    image: busybox:1.37.0
    init: true
    command: ["sh", "-c", "trap 'exit 0' TERM; while :; do sleep 3600 & wait $$!; done"]
    volumes:
      - data:/data
volumes:
  data: {}
`,
  "scripts/serve.sh": [
    "#!/bin/sh",
    'mkdir -p /tmp/www && echo "$GREETING $API_TOKEN $OFFICE_TEST_INSTANCE" > /tmp/www/index.html',
    'echo "serving on $1"',
    'exec httpd -f -p "$1" -h /tmp/www',
    "",
  ].join("\n"),
};

const INSTANCE_ID = "0b6a5d1e-7c2f-4e3a-9b8d-5f4e3d2c1b0a";
const SECRET = "s3cret-token";

// Test instances hands a test target's entry point over as contracts have it.
expectTypeOf<EntryPoint>().toExtend<HostedEntryPoint>();

const missing = await realRuntimeMissing();

describe.skipIf(missing !== undefined)(
  `HostedServices on the real container runtime${missing ? ` (skipped: ${missing})` : ""}`,
  REAL_RUNTIME_TEST,
  () => {
    const runtime = new ComposeCommandLine();
    let testbed: RunEnvironmentsTestbed;
    let start: HostedServiceStart;

    beforeAll(async () => {
      testbed = await runEnvironmentsTestbed(runtime, OPTIONS, undefined, { timeoutMs: 20_000 });
      const checkout = join(testbed.folder, "checkout");
      await writeFiles(checkout, DEFINITION);
      await chmod(join(checkout, "scripts/serve.sh"), 0o755);
      start = {
        instanceId: INSTANCE_ID,
        projectId: "shop",
        checkout,
        entryPoint: { kind: "repository-file", path: "scripts/serve.sh", arguments: ["8080"] },
        containerPort: 8080,
        variables: [
          { name: "GREETING", value: "hello" },
          { name: "API_TOKEN", value: SECRET },
        ],
        installCommand: "true",
        installInputs: [],
        installVariables: [],
        logFile: join(testbed.folder, "instance.log"),
        mask: new OutputMask([{ name: "API_TOKEN", value: SECRET }]),
      };
    }, REAL_RUNTIME_TEST.timeout);

    afterAll(async () => {
      await testbed.hostedServices.sweep();
      for (const { name } of await runtime.listImages(officeLabels(testbed.folders.instance))) {
        await runtime.removeImage(name);
      }
      await rm(testbed.folder, { recursive: true, force: true });
    }, REAL_RUNTIME_TEST.timeout);

    it("serves the entry point on 127.0.0.1 alone, then leaves no container, network or volume once stopped", async () => {
      const { hostPort } = await testbed.hostedServices.start(start, () => undefined);

      const page = await (await fetch(`http://127.0.0.1:${hostPort}/`)).text();
      expect(page).toBe(`hello ${SECRET} true\n`);
      const labels = testInstanceLabels(testbed.folders.instance, INSTANCE_ID);
      const resources = await runtime.listByLabel(labels);
      expect(resources.filter(({ kind }) => kind === "container")).toHaveLength(2);
      expect(resources.filter(({ kind }) => kind === "volume")).toHaveLength(1);

      await testbed.hostedServices.stop(INSTANCE_ID);

      expect(await runtime.listByLabel(labels)).toEqual([]);
      const log = await readFile(start.logFile, "utf8");
      expect(log).toContain("serving on 8080");
      expect(log).not.toContain(SECRET);
    });

    it("fails, removing what it started, when the app doesn't answer on its port", async () => {
      // The app listens on 8080, never 9090, where the runtime's port proxy still takes connections.
      const failing = testbed.hostedServices.start(
        { ...start, containerPort: 9090 },
        () => undefined,
      );

      await expect(failing).rejects.toMatchObject({
        reasons: ["The app didn't answer on port 9090."],
      });
      expect(
        await runtime.listByLabel(testInstanceLabels(testbed.folders.instance, INSTANCE_ID)),
      ).toEqual([]);
    });
  },
);
