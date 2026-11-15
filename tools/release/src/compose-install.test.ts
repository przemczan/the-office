import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { COMPOSE_ASSETS, COMPOSE_FOLDER, stampComposeEnv } from "./compose-install.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

interface ComposeService {
  readonly image?: string;
  readonly user?: string;
  readonly restart?: string;
  readonly profiles?: readonly string[];
  readonly group_add?: readonly string[];
  readonly network_mode?: string;
  readonly ports?: readonly string[];
  readonly volumes?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly env_file?: unknown;
  readonly depends_on?: Readonly<Record<string, { readonly condition: string }>>;
  readonly stop_grace_period?: string;
  readonly healthcheck?: unknown;
}

interface ComposeFile {
  readonly name: string;
  readonly services: Readonly<Record<string, ComposeService>>;
}

function readRepositoryFile(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

function composeFile(path: string): ComposeFile {
  return parse(readRepositoryFile(path)) as ComposeFile;
}

function serviceOf(compose: ComposeFile, name: string): ComposeService {
  const service = compose.services[name];
  assert.ok(service, `${name} is a service`);
  return service;
}

/** Each `${NAME…}` the text reads, by its name; `$${…}` is Compose's escape, not a variable. */
function variablesRead(text: string): Set<string> {
  return new Set([...text.matchAll(/(?<!\$)\$\{([A-Z_][A-Z0-9_]*)/g)].map((match) => match[1]!));
}

/** The keys `.env.example` sets, its commented `# NAME=` lines included. */
function keysOf(envText: string): Set<string> {
  return new Set([...envText.matchAll(/^(?:# )?([A-Z_][A-Z0-9_]*)=/gm)].map((match) => match[1]!));
}

const installComposeText = readRepositoryFile(
  `${COMPOSE_FOLDER}/${COMPOSE_ASSETS.composeFile.source}`,
);
const install = parse(installComposeText) as ComposeFile;
const envExample = readRepositoryFile(`${COMPOSE_FOLDER}/${COMPOSE_ASSETS.envFile.source}`);
const office = serviceOf(install, "office");

describe("the Compose install's docker-compose.yml", () => {
  it("is project the-office with The Office, its data folder step, Postgres, and Grafana behind its profile", () => {
    assert.equal(install.name, "the-office");
    assert.deepEqual(Object.keys(install.services).toSorted(), [
      "data-folder",
      "office",
      "otel-lgtm",
      "postgres",
    ]);
    assert.deepEqual(serviceOf(install, "otel-lgtm").profiles, ["grafana"]);
    for (const name of ["data-folder", "office", "postgres"]) {
      assert.equal(serviceOf(install, name).profiles, undefined, `${name} has no profile`);
    }
  });

  it("takes The Office's image tag only from OFFICE_VERSION, the same image for the data folder step", () => {
    assert.match(
      office.image ?? "",
      /^\$\{OFFICE_IMAGE:-ghcr\.io\/przemczan\/the-office\}:\$\{OFFICE_VERSION:\?[^}]*\}$/,
    );
    assert.equal(serviceOf(install, "data-folder").image, office.image);
  });

  it("runs The Office as the image's user, in the socket's group, on the host's network", () => {
    assert.equal(office.user, undefined);
    assert.equal(office.group_add?.length, 1);
    assert.match(office.group_add?.[0] ?? "", /^\$\{DOCKER_GID:\?[^}]*\}$/);
    assert.equal(office.network_mode, "host");
    assert.equal(office.ports, undefined);
  });

  it("mounts the Docker socket, and the data folder at the same path it names in OFFICE_DATA_DIR", () => {
    assert.ok(office.volumes?.includes("/var/run/docker.sock:/var/run/docker.sock"));
    const dataMounts = (office.volumes ?? []).filter((volume) =>
      volume.includes("OFFICE_DATA_DIR"),
    );
    assert.equal(dataMounts.length, 1);
    const [source, target] = dataMounts[0]!.split(/(?<=\}):/);
    assert.equal(source, target);
    assert.match(source ?? "", /^\$\{OFFICE_DATA_DIR[:?}]/);
    assert.equal(office.environment?.OFFICE_DATA_DIR, source);
    assert.deepEqual(serviceOf(install, "data-folder").volumes, dataMounts);
  });

  it("gives The Office only its own variables, listed one by one", () => {
    assert.equal(office.env_file, undefined);
    assert.deepEqual(Object.keys(office.environment ?? {}).toSorted(), [
      "DATABASE_URL",
      "OFFICE_DATA_DIR",
      "OFFICE_HOST",
      "OFFICE_PORT",
      "OFFICE_PUBLIC_ADDRESS",
      "OFFICE_SKIP_SETUP_BASICS",
    ]);
  });

  it("keeps The Office running, stops it gracefully and keeps the image's own health check", () => {
    assert.equal(office.restart, "unless-stopped");
    assert.equal(office.stop_grace_period, "1m");
    assert.equal(office.healthcheck, undefined);
  });

  it("starts The Office once Postgres is healthy and the data folder step has finished", () => {
    assert.deepEqual(office.depends_on, {
      postgres: { condition: "service_healthy" },
      "data-folder": { condition: "service_completed_successfully" },
    });
    const dataFolder = serviceOf(install, "data-folder");
    assert.equal(dataFolder.user, "0:0");
    assert.equal(dataFolder.restart, "no");
  });

  it("publishes Postgres on 127.0.0.1 alone, at the dev stack's pinned image, its data in a volume", () => {
    const postgres = serviceOf(install, "postgres");
    assert.ok((postgres.ports ?? []).length > 0);
    for (const port of postgres.ports ?? []) assert.match(port, /^127\.0\.0\.1:/);
    assert.equal(postgres.image, serviceOf(composeFile("docker-compose.yml"), "postgres").image);
    assert.equal(
      postgres.image,
      serviceOf(composeFile(".devcontainer/compose.yaml"), "postgres").image,
    );
    assert.match(postgres.image ?? "", /@sha256:[0-9a-f]{64}$/);
    assert.ok(postgres.volumes?.some((volume) => volume.startsWith("postgres-data:")));
    assert.match(postgres.environment?.POSTGRES_PASSWORD ?? "", /^\$\{POSTGRES_PASSWORD:\?/);
    assert.ok(postgres.healthcheck);
  });

  it("reads the variables .env.example lists, and .env.example lists no other", () => {
    const read = variablesRead(installComposeText);
    // Compose itself reads COMPOSE_PROFILES, not the file.
    const listed = new Set([...keysOf(envExample)].filter((key) => key !== "COMPOSE_PROFILES"));
    assert.deepEqual(read, listed);
  });
});

describe("the compose .env stamped for a release", () => {
  it("sets OFFICE_VERSION and keeps every other line", () => {
    const template = "# The release.\nOFFICE_VERSION=\nOFFICE_PORT=4310\n";
    assert.equal(
      stampComposeEnv(template, "1.2.3"),
      "# The release.\nOFFICE_VERSION=1.2.3\nOFFICE_PORT=4310\n",
    );
  });

  it("stamps the checkout's .env.example", () => {
    const stamped = stampComposeEnv(envExample, "1.2.3-rc.1");
    assert.match(stamped, /^OFFICE_VERSION=1\.2\.3-rc\.1$/m);
    assert.equal(stamped.split("\n").length, envExample.split("\n").length);
  });

  it("refuses a template with no OFFICE_VERSION= line, or with two", () => {
    assert.throws(() => stampComposeEnv("OFFICE_PORT=4310\n", "1.2.3"), /exactly one.*has 0/);
    assert.throws(
      () => stampComposeEnv("OFFICE_VERSION=\nOFFICE_VERSION=1.0.0\n", "1.2.3"),
      /exactly one.*has 2/,
    );
  });
});
