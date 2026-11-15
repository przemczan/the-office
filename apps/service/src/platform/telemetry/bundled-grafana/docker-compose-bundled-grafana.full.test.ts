import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bundledGrafanaComposeFile,
  COMPOSE_FILE,
  DockerComposeBundledGrafana,
} from "./docker-compose-bundled-grafana.js";

const run = promisify(execFile);

async function runtimeMissing(): Promise<string | undefined> {
  try {
    await run("docker", ["compose", "version"], { timeout: 20_000 });
    await run("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 20_000 });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message.split("\n")[0] : String(error);
  }
}

const missing = await runtimeMissing();

/**
 * On the real container runtime, without pulling the image or touching the machine's own bundled
 * Grafana: compose takes the written file, and the adapter's read-only calls answer.
 */
describe.skipIf(missing !== undefined)(
  `DockerComposeBundledGrafana on the real container runtime${missing ? ` (skipped: ${missing})` : ""}`,
  { timeout: 60_000 },
  () => {
    let root: string;
    let folder: string;

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "bundled-grafana-real-"));
      folder = join(root, "grafana");
      await mkdir(folder);
      await writeFile(join(folder, COMPOSE_FILE), bundledGrafanaComposeFile());
    });

    afterAll(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("writes a compose file compose takes, with its healthcheck and ports on 127.0.0.1", async () => {
      const { stdout } = await run(
        "docker",
        ["compose", "--file", join(folder, COMPOSE_FILE), "config", "--format", "json"],
        { cwd: folder, timeout: 20_000 },
      );
      const config = JSON.parse(stdout) as {
        name: string;
        services: Record<
          string,
          { healthcheck?: { test: string[] }; ports: { host_ip: string; published: string }[] }
        >;
        volumes: Record<string, unknown>;
      };
      const service = config.services["otel-lgtm"];

      expect(config.name).toBe("the-office-grafana");
      expect(service?.healthcheck?.test).toEqual(["CMD", "/otel-lgtm/docker/healthcheck.sh"]);
      expect(service?.ports.map((port) => `${port.host_ip}:${port.published}`).toSorted()).toEqual([
        "127.0.0.1:3300",
        "127.0.0.1:4317",
        "127.0.0.1:4318",
      ]);
      expect(Object.keys(config.volumes)).toEqual(["data"]);
    });

    it("reads the state and the earlier containers through the real CLI", async () => {
      const grafana = new DockerComposeBundledGrafana(folder);

      expect(["absent", "stopped", "starting", "unhealthy", "running"]).toContain(
        await grafana.state(),
      );
      expect(Array.isArray(await grafana.earlierContainers())).toBe(true);
    });
  },
);
