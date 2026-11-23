import { randomUUID } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  projectRefusalSchema,
  repositoryCloneSchema,
  type NewProject,
  type RepositoryClone,
} from "@the-office/contracts";
import { expect } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { RepositoryCloneFinished } from "../../domain/repository-clone-events.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";

export const HOST = "https://git.example.test/acme/";
/** Where `${HOST}missing` really goes: https to a port nothing answers on. */
export const UNANSWERED = "https://127.0.0.1:1/acme/missing";

/**
 * Git config, as the user's global config could hold it, that reads a URL on the made-up host as
 * the bare repository of that name beside the test's repository, since a Repository URL is never
 * a local path, and gives the identity a clone's first commit is written by, as the Linux check's
 * container has none.
 */
function madeUpHostConfig(folder: string): Record<string, string> {
  const local = `${folder.replaceAll("\\", "/")}/`;
  const settings: [string, string][] = [
    [`url.${local}.insteadOf`, HOST],
    // insteadOf is case-sensitive, as Linux's file names are.
    [`url.${local}origin.git.insteadOf`, `${HOST}Origin.git`],
    [`url.${UNANSWERED}.insteadOf`, `${HOST}missing`],
    ["user.name", "The Office"],
    ["user.email", "office@localhost"],
  ];
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(settings.length)],
    ...settings.flatMap(([key, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, key],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ]),
  ]);
}

/**
 * A temporary repository with bare repositories beside it for the made-up host, which the
 * process's git config reads URLs on until `forget` is called.
 */
export async function aClonesRepository(): Promise<{
  repository: TemporaryRepository;
  officeData: string;
  forget: () => void;
}> {
  const repository = await createTemporaryRepository();
  const officeData = join(repository.folder, "office-data");
  for (const empty of ["empty.git", "unborn.git", "closed.git", "filled.git"]) {
    gitIn(repository.folder, "init", "--quiet", "--bare", empty);
  }
  // A remote that refuses every push, as one the Office identity may not write to.
  const refusing = join(repository.folder, "closed.git", "hooks", "pre-receive");
  await writeFile(refusing, '#!/bin/sh\necho "Pushes are closed here." >&2\nexit 1\n');
  await chmod(refusing, 0o755);
  gitIn(repository.folder, "clone", "--quiet", "--bare", repository.path, "shop.git");
  gitIn(join(repository.folder, "shop.git"), "branch", "release", "main");
  gitIn(repository.folder, "clone", "--quiet", "--bare", repository.path, "store.git");
  gitIn(repository.folder, "clone", "--quiet", "--bare", repository.path, "depot.git");
  const madeUpHost = madeUpHostConfig(repository.folder);
  Object.assign(process.env, madeUpHost);
  return {
    repository,
    officeData,
    forget: () => {
      for (const name of Object.keys(madeUpHost)) delete process.env[name];
    },
  };
}

function aClonedProject(path: string, repositoryUrl: string, baseBranch: string): NewProject {
  return {
    name: `Cloned ${randomUUID().slice(0, 8)}`,
    path,
    repositoryUrl,
    baseBranch,
    mark: { label: "CL", colour: "teal" },
    installCommand: "npm ci",
    commands: [
      {
        key: "build",
        name: "Build",
        kind: "build",
        commandLine: "npm run build",
        rerunCommandLine: "",
      },
      {
        key: "lint",
        name: "Lint",
        kind: "lint",
        commandLine: "npm run lint",
        rerunCommandLine: "",
      },
      { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
}

/** The requests the Repository clone routes' tests share, on the app `current` gives. */
export function repositoryClonesHttp(
  current: () => {
    readonly app: INestApplication;
    readonly url: string;
    readonly officeData: string;
  },
) {
  function send(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
    return fetch(`${current().url}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  /** Starts a clone of `repositoryUrl` and waits for it to finish. */
  async function cloned(repositoryUrl: string): Promise<RepositoryClone> {
    const finished = new Promise<string>((resolve) => {
      const unsubscribe = current()
        .app.get(EventBus)
        .subscribe(RepositoryCloneFinished, (event) => {
          unsubscribe();
          resolve(event.clone.id);
        });
    });
    const response = await send("POST", "/repositories/clones", { url: repositoryUrl });
    expect(response.status).toBe(202);
    const started = repositoryCloneSchema.parse(await response.json());
    expect(started.state).toBe("cloning");
    expect(await finished).toBe(started.id);
    return read(started.id);
  }

  async function read(cloneId: string): Promise<RepositoryClone> {
    const response = await send("GET", `/repositories/clones/${cloneId}`);
    expect(response.status).toBe(200);
    return repositoryCloneSchema.parse(await response.json());
  }

  async function refusalOf(repositoryUrl: string): Promise<readonly string[]> {
    const response = await send("POST", "/repositories/clones", { url: repositoryUrl });
    expect(response.status).toBe(422);
    return projectRefusalSchema.parse(await response.json()).reasons;
  }

  const clonePath = (...names: string[]) =>
    join(current().officeData, "repositories", "git.example.test", "acme", ...names);

  return { send, cloned, read, refusalOf, clonePath, aClonedProject };
}
