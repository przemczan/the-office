import { describe, expect, it } from "vitest";
import type { ComposeProject, RunningOfficeContainer } from "./office-container.js";
import type { PublishedRelease } from "./published-release.js";
import {
  NO_DOCKER_SOCKET,
  NO_REPOSITORY,
  NOT_INSTALLED,
  updateRefusal,
  type UpdateState,
} from "./update-refusal.js";

const launched = { launched: true };
const WINDOWS = "Updating The Office runs on Linux only.";

const newest: PublishedRelease = {
  version: "1.4.0",
  name: "The Office 1.4.0",
  publishedAt: new Date("2026-11-14T10:00:00Z"),
  notes: "",
  url: "https://github.com/owner/the-office/releases/tag/v1.4.0",
  assets: [
    { name: "the-office-1.4.0-linux-x64.tar.gz", url: "https://example.com/x64.tar.gz" },
    { name: "the-office-1.4.0-linux-x64.tar.gz.sha256", url: "https://example.com/x64.sha256" },
  ],
};

const release: UpdateState = {
  install: "release",
  installed: true,
  repository: "owner/the-office",
  newest,
  architecture: "x64",
};

const project: ComposeProject = {
  project: "the-office",
  service: "office",
  workingDirectory: "/srv/the-office",
  configFiles: ["/srv/the-office/docker-compose.yml"],
  environmentFiles: ["/srv/the-office/.env"],
};

const composed: RunningOfficeContainer = {
  id: "c0ffee",
  image: "ghcr.io/owner/the-office:1.3.0",
  imageId: "sha256:1234",
  compose: project,
  mounts: [],
};

function container(running: RunningOfficeContainer | undefined): UpdateState {
  return {
    install: "container",
    container: running ? { reachable: true, container: running } : undefined,
    newest,
  };
}

describe("Why a release install's Update is refused", () => {
  it("goes ahead in its releases folder, under its launcher, with a tarball for this CPU", () => {
    expect(updateRefusal(release, launched)).toBeUndefined();
  });

  it("refuses a release its launcher doesn't run from a releases folder", () => {
    expect(updateRefusal({ ...release, installed: false }, launched)).toBe(NOT_INSTALLED);
  });

  it("refuses a release that names no repository", () => {
    expect(updateRefusal({ ...release, repository: undefined }, launched)).toBe(NO_REPOSITORY);
  });

  it("refuses a newer version with no tarball for this CPU, naming the file", () => {
    expect(updateRefusal({ ...release, architecture: "arm64" }, launched)).toMatch(
      /^Version 1\.4\.0 has no tarball for Linux on arm64 \(the-office-1\.4\.0-linux-arm64\.tar\.gz and its \.sha256\)/,
    );
  });

  it("refuses first where the system has no updates", () => {
    expect(updateRefusal(release, { launched: true, systemRefusal: WINDOWS })).toBe(WINDOWS);
  });
});

describe("Why a container's Update is refused", () => {
  it("goes ahead in a container Docker Compose started, with its files in its folder", () => {
    expect(updateRefusal(container(composed), launched)).toBeUndefined();
  });

  it("waits for a check to read the container", () => {
    expect(updateRefusal(container(undefined), launched)).toBeUndefined();
  });

  it("refuses without Docker's socket", () => {
    const state: UpdateState = {
      install: "container",
      container: { reachable: false, problem: "EACCES" },
      newest,
    };
    expect(updateRefusal(state, launched)).toBe(NO_DOCKER_SOCKET);
  });

  it("refuses a container Docker Compose didn't start, with the command to update it by hand", () => {
    expect(updateRefusal(container({ ...composed, compose: undefined }), launched)).toMatch(
      /wasn't started by Docker Compose.*docker pull ghcr\.io\/owner\/the-office:1\.4\.0/,
    );
  });

  it("refuses compose files outside the compose folder", () => {
    const compose = { ...project, configFiles: ["/etc/compose/docker-compose.yml"] };
    expect(updateRefusal(container({ ...composed, compose }), launched)).toMatch(
      /\/etc\/compose\/docker-compose\.yml aren't inside its compose folder \/srv\/the-office/,
    );
  });
});
