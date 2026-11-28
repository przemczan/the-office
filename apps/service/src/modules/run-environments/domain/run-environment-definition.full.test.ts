import { describe, expect, it } from "vitest";
import {
  definitionProblemsOf,
  definitionStatusOf,
  readDefinition,
  readDevcontainer,
  type ComposeFileText,
  type DevcontainerSettings,
} from "./run-environment-definition.js";

const DEVCONTAINER = `{
  // The checks run in "app"; Postgres beside it.
  "name": "Example",
  "dockerComposeFile": ["compose.yaml"],
  "service": "app",
  "workspaceFolder": "/workspace",
  "customizations": { "vscode": { "extensions": [] } },
}`;

const COMPOSE = `
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        NODE_VERSION: "22"
    command: sleep infinity
  postgres:
    image: postgres:17
    volumes:
      - data:/var/lib/postgresql/data
networks:
  backend: {}
volumes:
  data: {}
`;

function settingsOf(text: string): DevcontainerSettings {
  const { value, problems } = readDevcontainer(text);
  expect(problems).toEqual([]);
  if (value === undefined) throw new Error("No settings.");
  return value;
}

function definitionProblems(compose: string, devcontainer = DEVCONTAINER): readonly string[] {
  const files: ComposeFileText[] = [{ path: ".devcontainer/compose.yaml", text: compose }];
  return readDefinition(settingsOf(devcontainer), files).problems;
}

/** The problems of the app service mounting each of `volumes`, beside a named volume `data`. */
function mountProblems(volumes: string): readonly string[] {
  return definitionProblems(
    `services:\n  app:\n    image: node:22\n    volumes:\n${volumes}volumes:\n  data: {}\n`,
  );
}

describe("readDevcontainer and readDefinition", () => {
  it("read a valid definition: its compose files, service, image build, services, networks and volumes", () => {
    const reading = readDefinition(settingsOf(DEVCONTAINER), [
      { path: ".devcontainer/compose.yaml", text: COMPOSE },
    ]);

    expect(reading).toEqual({
      value: {
        composeFiles: [".devcontainer/compose.yaml"],
        service: "app",
        serviceImage: {
          kind: "build",
          context: ".devcontainer",
          dockerfile: "Dockerfile",
          args: { NODE_VERSION: "22" },
        },
        services: ["app", "postgres"],
        runServices: ["app", "postgres"],
        networks: ["backend"],
        volumes: ["data"],
        overrideCommand: false,
      },
      problems: [],
    });
  });

  it("reads an image instead of a build, the user, and the services to run with the checks' own", () => {
    const settings = settingsOf(
      `{ "dockerComposeFile": "compose.yaml", "service": "app", "runServices": ["cache"],
         "remoteUser": "node", "overrideCommand": true }`,
    );
    const reading = readDefinition(settings, [
      {
        path: ".devcontainer/compose.yaml",
        text: "services:\n  app:\n    image: node:22\n  cache:\n    image: redis:8\n  other:\n    image: nginx\n",
      },
    ]);

    expect(reading.value).toMatchObject({
      serviceImage: { kind: "image", image: "node:22" },
      runServices: ["cache", "app"],
      user: "node",
      overrideCommand: true,
    });
  });

  it("reports a missing devcontainer.json", () => {
    expect(readDevcontainer(undefined).problems).toEqual([
      "The repository has no .devcontainer/devcontainer.json.",
    ]);
  });

  it("reports devcontainer.json that isn't JSON, or isn't one object", () => {
    expect(readDevcontainer("{ service: app").problems[0]).toMatch(
      /^devcontainer\.json isn't valid JSON: /,
    );
    expect(readDevcontainer("[]").problems).toEqual([
      "devcontainer.json must hold one JSON object.",
    ]);
  });

  it("reports no compose file and no service, together", () => {
    expect(readDevcontainer(`{ "image": "node:22" }`).problems).toEqual([
      `devcontainer.json sets "image", which The Office doesn't support.`,
      'devcontainer.json names no compose file: set "dockerComposeFile" to the compose file of the services the checks need.',
      'devcontainer.json names no service: set "service" to the one the checks run in.',
    ]);
  });

  it("reports each property The Office doesn't support", () => {
    const { problems } = readDevcontainer(
      `{ "dockerComposeFile": "compose.yaml", "service": "app",
         "features": {}, "postCreateCommand": "npm ci", "forwardPorts": [3000] }`,
    );

    expect(problems).toEqual([
      `devcontainer.json sets "features", which The Office doesn't support.`,
      `devcontainer.json sets "postCreateCommand", which The Office doesn't support.`,
      `devcontainer.json sets "forwardPorts", which The Office doesn't support.`,
    ]);
  });

  it("reports a compose file outside the repository", () => {
    expect(
      readDevcontainer(`{ "dockerComposeFile": "../../compose.yaml", "service": "app" }`).problems,
    ).toEqual(["The compose file ../../compose.yaml is outside the repository."]);
  });

  it("reports a compose file that isn't there, or isn't YAML", () => {
    const settings = settingsOf(`{ "dockerComposeFile": ["a.yaml", "b.yaml"], "service": "app" }`);

    const { problems } = readDefinition(settings, [
      { path: ".devcontainer/a.yaml", text: undefined },
      { path: ".devcontainer/b.yaml", text: "services: [unclosed" },
    ]);

    expect(problems).toHaveLength(2);
    expect(problems[0]).toBe("The compose file .devcontainer/a.yaml isn't there.");
    expect(problems[1]).toMatch(/^The compose file \.devcontainer\/b\.yaml isn't valid YAML: /);
  });

  it("reports the service devcontainer.json names when the compose file hasn't it", () => {
    expect(definitionProblems("services:\n  web:\n    image: nginx\n")).toEqual([
      "The service app that devcontainer.json names isn't in .devcontainer/compose.yaml.",
    ]);
  });

  it("reports a service with neither an image nor a build", () => {
    expect(definitionProblems("services:\n  app:\n    command: sleep infinity\n")).toEqual([
      "The service app has neither an image nor a build.",
    ]);
  });

  it("reports what would reach outside the run environment, or share it", () => {
    const problems = definitionProblems(`
services:
  app:
    image: node:22
    container_name: app
    ports: ["3000:3000"]
    privileged: true
    volumes:
      - ..:/workspace:cached
networks:
  shared:
    external: true
`);

    expect(problems).toEqual([
      "The service app in .devcontainer/compose.yaml sets \"container_name\": a fixed container name, which two Tasks' run environments can't both have.",
      "The service app in .devcontainer/compose.yaml sets \"ports\": ports published on this computer, which two Tasks' run environments can't both have.",
      'The service app in .devcontainer/compose.yaml sets "privileged": privileged mode, which gives it the whole computer.',
      "The service app in .devcontainer/compose.yaml mounts a folder of this computer: The Office mounts the worktree itself, so use named volumes only.",
      "The network shared in .devcontainer/compose.yaml is external: each run environment has its own networks.",
    ]);
  });

  it("reports limits a service sets of its own", () => {
    expect(
      definitionProblems("services:\n  app:\n    image: node:22\n    mem_limit: 16g\n"),
    ).toEqual([
      'The service app in .devcontainer/compose.yaml sets "mem_limit": The Office sets every service\'s limits.',
    ]);
  });

  // The override sets no shares, so the runtime's equal default weight is what holds.
  it("reports CPU shares a service sets of its own", () => {
    expect(
      definitionProblems("services:\n  app:\n    image: node:22\n    cpu_shares: 4096\n"),
    ).toEqual([
      'The service app in .devcontainer/compose.yaml sets "cpu_shares": The Office sets every service\'s limits.',
    ]);
  });

  it("reports a build setting The Office doesn't support", () => {
    expect(
      definitionProblems("services:\n  app:\n    build:\n      context: .\n      ssh: [default]\n"),
    ).toEqual([`The service app's build sets "ssh", which The Office doesn't support.`]);
  });

  it("reports any property a service sets that The Office doesn't take, and leaves x- ones", () => {
    expect(
      definitionProblems(`
services:
  app:
    image: node:22
    x-notes: kept
    env_file: /etc/environment
    extends: { file: ../../other.yaml, service: base }
    secrets: [token]
    use_api_socket: true
    gpus: all
`),
    ).toEqual([
      'The service app in .devcontainer/compose.yaml sets "env_file": variables from a file compose reads on this computer: give them in "environment".',
      `The service app in .devcontainer/compose.yaml sets "extends": a service of another file, which The Office doesn't check: write the service whole.`,
      'The service app in .devcontainer/compose.yaml sets "secrets": secrets from files or variables of this computer.',
      `The service app in .devcontainer/compose.yaml sets "use_api_socket": the container runtime's socket, which gives it the whole computer.`,
      `The service app in .devcontainer/compose.yaml sets "gpus", which The Office doesn't support.`,
    ]);
  });

  it("checks what a merge key brings into a service", () => {
    expect(
      definitionProblems(`
x-base: &base
  privileged: true
services:
  app:
    <<: *base
    image: node:22
`),
    ).toEqual([
      'The service app in .devcontainer/compose.yaml sets "privileged": privileged mode, which gives it the whole computer.',
    ]);
  });

  it("reports a compose file's own property The Office doesn't take: an include, secrets or configs", () => {
    expect(
      definitionProblems(`
include: [../../elsewhere.yaml]
services:
  app:
    image: node:22
secrets:
  token: { file: /home/office/.ssh/id_ed25519 }
configs:
  settings: { file: /etc/shadow }
`),
    ).toEqual([
      `The compose file .devcontainer/compose.yaml sets "include", which The Office doesn't support.`,
      `The compose file .devcontainer/compose.yaml sets "secrets", which The Office doesn't support.`,
      `The compose file .devcontainer/compose.yaml sets "configs", which The Office doesn't support.`,
    ]);
  });

  it("reports a variable read from The Office's environment, and takes $$ as a $", () => {
    expect(
      definitionProblems(`
services:
  app:
    image: node:22
    environment:
      LEAKED: \${DATABASE_URL}
      PRICE: "$$5"
    healthcheck:
      test: ["CMD-SHELL", 'test -n "$$HOME" && echo $HOME']
`),
    ).toEqual([
      "The compose file .devcontainer/compose.yaml reads a variable at services.app.environment.LEAKED: compose would take it from The Office's own environment, so write the value itself, or $$ for a $.",
      "The compose file .devcontainer/compose.yaml reads a variable at services.app.healthcheck.test[1]: compose would take it from The Office's own environment, so write the value itself, or $$ for a $.",
    ]);
  });

  it("reports a variable given no value, which compose would fill from The Office's environment", () => {
    expect(
      definitionProblems(`
services:
  app:
    image: node:22
    environment: [DATABASE_URL, "CI=1"]
  worker:
    build:
      context: .
      args:
        GH_TOKEN:
        NODE_VERSION: "22"
    environment:
      ANTHROPIC_API_KEY:
`),
    ).toEqual([
      `The service app in .devcontainer/compose.yaml gives DATABASE_URL no value in "environment": compose would take it from The Office's own environment.`,
      `The service worker in .devcontainer/compose.yaml gives ANTHROPIC_API_KEY no value in "environment": compose would take it from The Office's own environment.`,
      `The service worker's build gives GH_TOKEN no value in "args": compose would take it from The Office's own environment.`,
    ]);
  });

  it("reports every mount of a folder or pipe of this computer, and takes named volumes and a tmpfs", () => {
    const folder =
      "The service app in .devcontainer/compose.yaml mounts a folder of this computer: The Office mounts the worktree itself, so use named volumes only.";

    expect(
      mountProblems(
        "      - data:/data\n      - /anonymous\n      - { type: volume, source: data, target: /more }\n      - { type: tmpfs, target: /tmp }\n",
      ),
    ).toEqual([]);
    for (const volume of [
      "/:/host",
      "~/.ssh:/keys",
      "./src:/src",
      "C:\\Users\\office:/h",
      "c:/Users:/h",
      "\\\\.\\pipe\\docker_engine:/pipe",
      "{ type: bind, source: /, target: /host }",
      "{ type: npipe, source: '\\\\.\\pipe\\docker_engine', target: /pipe }",
      "{ type: volume, source: /etc, target: /etc-copy }",
    ]) {
      expect(
        mountProblems(`      - ${volume.startsWith("{") ? volume : JSON.stringify(volume)}\n`),
      ).toEqual([folder]);
    }
  });

  it("refuses a mount whose source reads a variable, whatever it would be", () => {
    expect(
      definitionProblems('services:\n  app:\n    image: node:22\n    volumes: ["${HOME}:/h"]\n'),
    ).toEqual([
      "The compose file .devcontainer/compose.yaml reads a variable at services.app.volumes[0]: compose would take it from The Office's own environment, so write the value itself, or $$ for a $.",
      "The service app in .devcontainer/compose.yaml mounts a folder of this computer: The Office mounts the worktree itself, so use named volumes only.",
    ]);
  });

  it("reports a declared volume or network reaching past the runtime's own plain ones", () => {
    expect(
      definitionProblems(`
services:
  app:
    image: node:22
volumes:
  root:
    driver_opts: { type: none, o: bind, device: / }
  shared:
    name: the-office_postgres-data
  data:
    labels: { purpose: cache }
networks:
  lan:
    driver: macvlan
  private:
    internal: true
`),
    ).toEqual([
      `The network lan in .devcontainer/compose.yaml sets "driver", which The Office doesn't support.`,
      `The volume root in .devcontainer/compose.yaml sets "driver_opts", which The Office doesn't support.`,
      `The volume shared in .devcontainer/compose.yaml sets "name", which The Office doesn't support.`,
    ]);
  });

  it("reports another service's build reading outside the repository", () => {
    expect(
      definitionProblems(`
services:
  app:
    image: node:22
  root:
    build: /
  home:
    build: { context: "~" }
  above:
    build: { context: ../.. }
  passwd:
    build: { context: ., dockerfile: /etc/passwd }
  web:
    build: { context: .., dockerfile: web/Dockerfile }
`),
    ).toEqual([
      "The service root's build context is outside the repository.",
      "The service home's build context is outside the repository.",
      "The service above's build context is outside the repository.",
      "The service passwd's Dockerfile is outside the repository.",
    ]);
  });

  it("reports the checks' service built from outside .devcontainer/, which its image's key doesn't hold", () => {
    const words =
      "The service app's build context and Dockerfile must be in .devcontainer/: its image is keyed by that folder alone, so a file outside it wouldn't build the image again when it changed. Copy what it needs there, or have the install command make it from the Install inputs.";

    expect(definitionProblems("services:\n  app:\n    build: ..\n")).toEqual([words]);
    expect(
      definitionProblems(
        "services:\n  app:\n    build:\n      context: .\n      dockerfile: ../Dockerfile\n",
      ),
    ).toEqual([words]);
    expect(definitionProblems("services:\n  app:\n    build:\n      context: ./image\n")).toEqual(
      [],
    );
  });

  it("reports an image that isn't one name", () => {
    expect(
      definitionProblems(
        'services:\n  app:\n    image: "alpine\\nRUN --mount=type=secret,id=OFFICE_VARIABLE_0 cat"\n',
      ),
    ).toEqual([
      "The service app's image \"alpine\\nRUN --mount=type=secret,id=OFFICE_VARIABLE_0 cat\" isn't an image's name.",
    ]);
  });
});

describe("definitionStatusOf", () => {
  const valid = readDefinition(
    { composeFiles: [".devcontainer/compose.yaml"], service: "app", overrideCommand: false },
    [{ path: ".devcontainer/compose.yaml", text: "services:\n  app:\n    image: node:22\n" }],
  );

  it("tells a missing devcontainer.json from an invalid one", () => {
    const missing = { found: false, reading: { problems: readDevcontainer(undefined).problems } };
    const invalid = { found: true, reading: { problems: readDevcontainer("{}").problems } };

    expect(definitionStatusOf(missing)).toEqual({ state: "not-found" });
    expect(definitionStatusOf(invalid)).toEqual({
      state: "not-valid",
      problems: invalid.reading.problems,
    });
    expect(definitionStatusOf({ found: true, reading: valid })).toEqual({ state: "valid" });
  });

  it("gives every reason the definition can't be used, none when it is valid", () => {
    expect(definitionProblemsOf({ state: "valid" })).toEqual([]);
    expect(definitionProblemsOf({ state: "not-found" })).toEqual([
      "The repository has no .devcontainer/devcontainer.json.",
    ]);
    expect(definitionProblemsOf({ state: "not-valid", problems: ["A problem."] })).toEqual([
      "A problem.",
    ]);
  });
});
