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
      context: ..
      dockerfile: .devcontainer/Dockerfile
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
          context: ".",
          dockerfile: ".devcontainer/Dockerfile",
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
